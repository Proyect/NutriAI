import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Activity, 
  User as UserIcon, 
  Plus, 
  History, 
  Scale, 
  TrendingUp,
  LogOut,
  ChevronRight,
  Utensils,
  Dumbbell,
  Calendar,
  Sparkles,
  MessageSquare,
  Send,
  MapPin,
  Edit2,
  Trash2,
  Droplets,
  Droplet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  AreaChart,
  Area,
  CartesianGrid,
  XAxis, 
  YAxis, 
  Tooltip,
  Legend
} from 'recharts';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  onAuthStateChanged, 
  User 
} from './firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  addDoc,
  Timestamp
} from 'firebase/firestore';
import { estimateCaloriesFromImage, estimateMealCalories, estimateActivityCalories, generateHealthPlan, adjustHealthPlan, searchNearbyPlaces, FoodEstimation, HealthPlan, NearbyPlace } from './services/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface UserProfile {
  uid: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  height: number;
  weight: number;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  workType: 'office' | 'standing' | 'physical_moderate' | 'physical_intense';
  goal: 'lose' | 'maintain' | 'gain';
  targetWeight?: number;
}

interface Meal {
  id: string;
  mealType: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  timestamp: any;
}

interface WaterLog {
  id: string;
  amount: number; // in ml
  timestamp: any;
}

interface ActivityLog {
  id: string;
  activityName: string;
  durationMinutes: number;
  caloriesBurned: number;
  timestamp: any;
}

interface WeightLog {
  id: string;
  weight: number;
  timestamp: any;
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'meals' | 'activity' | 'profile' | 'planning' | 'nearby'>('dashboard');
  const [meals, setMeals] = useState<Meal[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [waterLogs, setWaterLogs] = useState<WaterLog[]>([]);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityLog | null>(null);
  const [showMealForm, setShowMealForm] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [planning, setPlanning] = useState<HealthPlan | null>(null);

  // Auth Listener
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Connection Test
  useEffect(() => {
    if (!db) return;
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Profile & Data Listener
  useEffect(() => {
    if (!user || !db) return;

    const profileRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      }
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

    const mealsQuery = query(collection(db, 'users', user.uid, 'meals'), orderBy('timestamp', 'desc'), limit(20));
    const unsubMeals = onSnapshot(mealsQuery, (snap) => {
      setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Meal)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/meals`));

    const activitiesQuery = query(collection(db, 'users', user.uid, 'activities'), orderBy('timestamp', 'desc'), limit(20));
    const unsubActivities = onSnapshot(activitiesQuery, (snap) => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/activities`));

    const planningRef = doc(db, 'users', user.uid, 'planning', 'current');
    const unsubPlanning = onSnapshot(planningRef, (docSnap) => {
      if (docSnap.exists()) {
        setPlanning(docSnap.data() as HealthPlan);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}/planning/current`));

    const waterQuery = query(collection(db, 'users', user.uid, 'water'), orderBy('timestamp', 'desc'), limit(50));
    const unsubWater = onSnapshot(waterQuery, (snap) => {
      setWaterLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as WaterLog)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/water`));

    const weightQuery = query(collection(db, 'users', user.uid, 'weightLogs'), orderBy('timestamp', 'asc'), limit(100));
    const unsubWeight = onSnapshot(weightQuery, (snap) => {
      setWeightLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as WeightLog)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/weightLogs`));

    return () => {
      unsubProfile();
      unsubMeals();
      unsubActivities();
      unsubPlanning();
      unsubWater();
      unsubWeight();
    };
  }, [user]);

  const handleLogin = React.useCallback(async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error(err);
    }
  }, []);

  const imcValue = React.useMemo(() => {
    if (!profile) return 0;
    const heightInMeters = profile.height / 100;
    return Number((profile.weight / (heightInMeters * heightInMeters)).toFixed(1));
  }, [profile]);

  const imcCategory = React.useMemo(() => {
    if (imcValue < 18.5) return { label: 'Bajo peso', color: 'text-blue-500' };
    if (imcValue < 25) return { label: 'Normal', color: 'text-emerald-500' };
    if (imcValue < 30) return { label: 'Sobrepeso', color: 'text-yellow-500' };
    return { label: 'Obesidad', color: 'text-red-500' };
  }, [imcValue]);

  const calorieGoal = React.useMemo(() => {
    if (!profile) return 2000;
    let bmr = 0;
    if (profile.gender === 'male') {
      bmr = 88.36 + (13.4 * profile.weight) + (4.8 * profile.height) - (5.7 * profile.age);
    } else {
      bmr = 447.59 + (9.2 * profile.weight) + (3.1 * profile.height) - (4.3 * profile.age);
    }

    const activityMultipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9
    };

    const workMultipliers = {
      office: 1.0,
      standing: 1.1,
      physical_moderate: 1.2,
      physical_intense: 1.3
    };

    let tdee = bmr * activityMultipliers[profile.activityLevel] * (workMultipliers[profile.workType] || 1.0);
    
    if (profile.goal === 'lose') tdee -= 500;
    if (profile.goal === 'gain') tdee += 500;

    return Math.round(tdee);
  }, [profile]);

  const consumedToday = React.useMemo(() => {
    const today = new Date().toDateString();
    return meals
      .filter(m => {
        const date = m.timestamp?.toDate ? m.timestamp.toDate() : null;
        return date instanceof Date && date.toDateString() === today;
      })
      .reduce((acc, curr) => acc + curr.calories, 0);
  }, [meals]);

  const burnedToday = React.useMemo(() => {
    const today = new Date().toDateString();
    return activities
      .filter(a => {
        const date = a.timestamp?.toDate ? a.timestamp.toDate() : null;
        return date instanceof Date && date.toDateString() === today;
      })
      .reduce((acc, curr) => acc + curr.caloriesBurned, 0);
  }, [activities]);

  const waterToday = React.useMemo(() => {
    const today = new Date().toDateString();
    return waterLogs
      .filter(w => {
        const date = w.timestamp?.toDate ? w.timestamp.toDate() : null;
        return date instanceof Date && date.toDateString() === today;
      })
      .reduce((acc, curr) => acc + curr.amount, 0);
  }, [waterLogs]);

  const macroTotals = React.useMemo(() => {
    const today = new Date().toDateString();
    return meals
      .filter(m => {
        const date = m.timestamp?.toDate ? m.timestamp.toDate() : null;
        return date instanceof Date && date.toDateString() === today;
      })
      .reduce((acc, curr) => ({
        protein: acc.protein + (curr.protein || 0),
        carbs: acc.carbs + (curr.carbs || 0),
        fat: acc.fat + (curr.fat || 0)
      }), { protein: 0, carbs: 0, fat: 0 });
  }, [meals]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-emerald-600 font-bold text-2xl font-serif italic"
        >
          NutriAI...
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (!profile) {
    return <OnboardingView user={user} onComplete={(p) => setProfile(p)} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-24 text-stone-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 p-4 sticky top-0 z-10 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
            <Activity size={20} />
          </div>
          <h1 className="font-serif italic font-bold text-xl text-stone-800">NutriAI</h1>
        </div>
        <button onClick={() => logout()} className="p-2 text-stone-400 hover:text-red-500 transition-colors">
          <LogOut size={20} />
        </button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6">
        {activeTab === 'dashboard' && (
          <DashboardView 
            profile={profile} 
            consumed={consumedToday} 
            burned={burnedToday} 
            goal={calorieGoal}
            imc={imcValue}
            imcCategory={imcCategory}
            macros={macroTotals}
            water={waterToday}
            weightLogs={weightLogs}
            onAddWater={async (amount: number) => {
              if (user && db) {
                const path = `users/${user.uid}/water`;
                try {
                  await addDoc(collection(db, path), {
                    amount,
                    timestamp: Timestamp.now()
                  });
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, path);
                }
              }
            }}
            onAddWeight={async (weight: number) => {
              if (user && db) {
                const path = `users/${user.uid}/weightLogs`;
                try {
                  await addDoc(collection(db, path), {
                    weight,
                    timestamp: Timestamp.now()
                  });
                  // Update profile weight if it's the latest
                  await setDoc(doc(db, 'users', user.uid), { ...profile, weight }, { merge: true });
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, path);
                }
              }
            }}
          />
        )}
        {activeTab === 'meals' && (
          <MealsView 
            meals={meals} 
            onAdd={() => {
              setEditingMeal(null);
              setShowCamera(true);
            }} 
            onDescribe={() => {
              setEditingMeal(null);
              setShowMealForm(true);
            }} 
            onEdit={(meal) => {
              setEditingMeal(meal);
              setShowMealForm(true);
            }}
            onDelete={async (id) => {
              if (user && db && confirm('¿Eliminar esta comida?')) {
                try {
                  const { deleteDoc, doc } = await import('firebase/firestore');
                  await deleteDoc(doc(db, 'users', user.uid, 'meals', id));
                } catch (err) {
                  handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/meals/${id}`);
                }
              }
            }}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityView 
            activities={activities} 
            onAdd={() => {
              setEditingActivity(null);
              setShowActivityForm(true);
            }}
            onEdit={(act) => {
              setEditingActivity(act);
              setShowActivityForm(true);
            }}
            onDelete={async (id) => {
              if (user && db && confirm('¿Estás seguro de que quieres eliminar esta actividad?')) {
                const path = `users/${user.uid}/activities/${id}`;
                try {
                  const { deleteDoc, doc } = await import('firebase/firestore');
                  await deleteDoc(doc(db, 'users', user.uid, 'activities', id));
                } catch (err) {
                  handleFirestoreError(err, OperationType.DELETE, path);
                }
              }
            }}
          />
        )}
        {activeTab === 'planning' && (
          <PlanningView 
            profile={profile} 
            planning={planning} 
            meals={meals}
            activities={activities}
            onGenerate={async (instructions?: string) => {
              if (user && db) {
                const path = `users/${user.uid}/planning/current`;
                try {
                  const newPlan = await generateHealthPlan(profile, meals, activities, instructions);
                  await setDoc(doc(db, path), newPlan);
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, path);
                }
              }
            }} 
            onAdjust={async (feedback: string) => {
              if (user && db && planning) {
                const path = `users/${user.uid}/planning/current`;
                try {
                  const updatedPlan = await adjustHealthPlan(planning, feedback, profile, meals, activities);
                  await setDoc(doc(db, path), updatedPlan);
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, path);
                }
              }
            }}
          />
        )}
        {activeTab === 'profile' && <ProfileView profile={profile} />}
        {activeTab === 'nearby' && <NearbyView />}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-2 flex justify-around items-center z-20">
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<TrendingUp size={24} />} label="Inicio" />
        <NavButton active={activeTab === 'meals'} onClick={() => setActiveTab('meals')} icon={<Utensils size={24} />} label="Comidas" />
        <NavButton active={activeTab === 'planning'} onClick={() => setActiveTab('planning')} icon={<Calendar size={24} />} label="Plan" />
        <div className="relative -top-6">
          <button 
            onClick={() => setShowCamera(true)}
            className="w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-200 flex items-center justify-center hover:bg-emerald-700 transition-all active:scale-95"
          >
            <Camera size={28} />
          </button>
        </div>
        <NavButton active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} icon={<Dumbbell size={24} />} label="Deporte" />
        <NavButton active={activeTab === 'nearby'} onClick={() => setActiveTab('nearby')} icon={<MapPin size={24} />} label="Cerca" />
        <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<UserIcon size={24} />} label="Perfil" />
      </nav>

      {/* Camera/Estimation Modal */}
      <AnimatePresence>
        {showCamera && (
          <CameraModal 
            onClose={() => setShowCamera(false)} 
            onEstimate={async (img) => {
              setIsEstimating(true);
              try {
                const est = await estimateCaloriesFromImage(img);
                if (user && db) {
                  const path = `users/${user.uid}/meals`;
                  try {
                    await addDoc(collection(db, path), {
                      ...est,
                      mealType: 'snack',
                      timestamp: Timestamp.now()
                    });
                  } catch (err) {
                    handleFirestoreError(err, OperationType.WRITE, path);
                  }
                }
                setShowCamera(false);
              } catch (err) {
                alert("Error al analizar la imagen");
              } finally {
                setIsEstimating(false);
              }
            }}
            isEstimating={isEstimating}
          />
        )}
        {showActivityForm && (
          <ActivityModal 
            onClose={() => {
              setShowActivityForm(false);
              setEditingActivity(null);
            }}
            initialData={editingActivity || undefined}
            onSave={async (act) => {
              if (user && db) {
                try {
                  if (editingActivity) {
                    const path = `users/${user.uid}/activities/${editingActivity.id}`;
                    const { updateDoc, doc } = await import('firebase/firestore');
                    await updateDoc(doc(db, 'users', user.uid, 'activities', editingActivity.id), {
                      ...act
                    });
                  } else {
                    const path = `users/${user.uid}/activities`;
                    await addDoc(collection(db, path), {
                      ...act,
                      timestamp: Timestamp.now()
                    });
                  }
                  setShowActivityForm(false);
                  setEditingActivity(null);
                } catch (err) {
                  handleFirestoreError(err, editingActivity ? OperationType.UPDATE : OperationType.WRITE, `users/${user.uid}/activities`);
                }
              }
            }}
          />
        )}
        {showMealForm && (
          <MealModal 
            onClose={() => {
              setShowMealForm(false);
              setEditingMeal(null);
            }}
            initialData={editingMeal || undefined}
            onSave={async (meal) => {
              if (user && db) {
                try {
                  if (editingMeal) {
                    const { updateDoc, doc } = await import('firebase/firestore');
                    await updateDoc(doc(db, 'users', user.uid, 'meals', editingMeal.id), {
                      ...meal
                    });
                  } else {
                    const path = `users/${user.uid}/meals`;
                    await addDoc(collection(db, path), {
                      ...meal,
                      timestamp: Timestamp.now()
                    });
                  }
                  setShowMealForm(false);
                  setEditingMeal(null);
                } catch (err) {
                  handleFirestoreError(err, editingMeal ? OperationType.UPDATE : OperationType.WRITE, `users/${user.uid}/meals`);
                }
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-Views ---

function LoginView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-stone-900 text-white flex flex-col items-center justify-center p-8">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-6 max-w-sm"
      >
        <div className="w-20 h-20 bg-emerald-500 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-emerald-500/20">
          <Activity size={40} />
        </div>
        <h1 className="text-5xl font-serif italic font-bold tracking-tight">NutriAI</h1>
        <p className="text-stone-400 text-lg">Tu compañero inteligente para una vida saludable. Estima calorías con solo una foto.</p>
        <button 
          onClick={onLogin}
          className="w-full bg-white text-stone-900 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-stone-100 transition-all active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Continuar con Google
        </button>
      </motion.div>
    </div>
  );
}

function OnboardingView({ user, onComplete }: { user: User, onComplete: (p: UserProfile) => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    uid: user.uid,
    displayName: user.displayName || '',
    gender: 'male',
    activityLevel: 'moderate',
    workType: 'office',
    goal: 'maintain'
  });

  const handleComplete = async () => {
    if (!db) return;
    const profile = formData as UserProfile;
    await setDoc(doc(db, 'users', user.uid), profile);
    onComplete(profile);
  };

  return (
    <div className="min-h-screen bg-stone-50 p-6 flex flex-col">
      <div className="flex-1 max-w-md mx-auto w-full space-y-8 pt-12">
        <div className="space-y-2">
          <span className="text-emerald-600 font-mono text-sm font-bold uppercase tracking-widest">Paso {step} de 3</span>
          <h2 className="text-3xl font-serif italic font-bold">Cuéntanos sobre ti</h2>
        </div>

        {step === 1 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 relative z-10">
            <Input label="Edad" type="number" value={formData.age} onChange={v => setFormData({ ...formData, age: v === '' ? undefined : Number(v) })} />
            <div className="grid grid-cols-2 gap-4">
              <Select label="Género" value={formData.gender} options={[{v: 'male', l: 'Hombre'}, {v: 'female', l: 'Mujer'}]} onChange={v => setFormData({ ...formData, gender: v as any })} />
              <Input label="Altura (cm)" type="number" value={formData.height} onChange={v => setFormData({ ...formData, height: v === '' ? undefined : Number(v) })} />
            </div>
            <Input label="Peso Actual (kg)" type="number" value={formData.weight} onChange={v => setFormData({ ...formData, weight: v === '' ? undefined : Number(v) })} />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
            <Select 
              label="Nivel de Actividad Deportiva" 
              value={formData.activityLevel} 
              options={[
                {v: 'sedentary', l: 'Sedentario (Sin ejercicio)'},
                {v: 'light', l: 'Ligero (1-2 días/sem)'},
                {v: 'moderate', l: 'Moderado (3-5 días/sem)'},
                {v: 'active', l: 'Activo (6-7 días/sem)'},
                {v: 'very_active', l: 'Muy Activo (Atleta)'}
              ]} 
              onChange={v => setFormData({ ...formData, activityLevel: v as any })} 
            />
            <Select 
              label="Tipo de Trabajo / Desgaste Diario" 
              value={formData.workType} 
              options={[
                {v: 'office', l: 'Oficina / Sentado'},
                {v: 'standing', l: 'De pie / Caminando'},
                {v: 'physical_moderate', l: 'Físico Moderado (Limpieza, Reparto)'},
                {v: 'physical_intense', l: 'Físico Intenso (Construcción, Carga)'}
              ]} 
              onChange={v => setFormData({ ...formData, workType: v as any })} 
            />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 relative z-10">
            <Select 
              label="Tu Objetivo" 
              value={formData.goal} 
              options={[
                {v: 'lose', l: 'Perder Peso'},
                {v: 'maintain', l: 'Mantener Peso'},
                {v: 'gain', l: 'Ganar Músculo'}
              ]} 
              onChange={v => setFormData({ ...formData, goal: v as any })} 
            />
            <Input label="Peso Objetivo (kg)" type="number" value={formData.targetWeight} onChange={v => setFormData({ ...formData, targetWeight: v === '' ? undefined : Number(v) })} />
          </motion.div>
        )}

        <div className="pt-8 flex gap-4">
          {step > 1 && (
            <button 
              onClick={() => setStep(step - 1)}
              className="flex-1 bg-stone-200 text-stone-700 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-stone-300 transition-all"
            >
              Anterior
            </button>
          )}
          <button 
            onClick={() => step < 3 ? setStep(step + 1) : handleComplete()}
            className="flex-[2] bg-stone-900 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-stone-800 transition-all"
          >
            {step === 3 ? 'Comenzar' : 'Siguiente'}
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ profile, consumed, burned, goal, imc, imcCategory, macros, water, weightLogs, onAddWater, onAddWeight }: any) {
  const remaining = goal - consumed + burned;
  const progress = Math.min((consumed / goal) * 100, 100);
  const [showWeightModal, setShowWeightModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="bg-stone-900 text-white p-6 rounded-[2.5rem] shadow-xl space-y-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-3xl" />
        
        <div className="flex justify-between items-end relative z-10">
          <div className="space-y-1">
            <span className="text-stone-400 text-[10px] uppercase tracking-widest font-bold">Calorías Restantes</span>
            <div className="text-6xl font-serif italic font-bold tracking-tighter">{remaining}</div>
          </div>
          <div className="text-right">
            <span className="text-stone-400 text-[10px] uppercase tracking-widest font-bold">Meta Diaria</span>
            <div className="text-xl font-bold">{goal} <span className="text-xs font-normal text-stone-500">kcal</span></div>
          </div>
        </div>

        <div className="space-y-3 relative z-10">
          <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-emerald-500"
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-stone-400 uppercase tracking-wider">
            <span>Consumido: {consumed}</span>
            <span>Quemado: {burned}</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-stone-100 card-shadow space-y-2">
          <div className="flex items-center gap-2 text-stone-400">
            <Scale size={14} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Tu IMC</span>
          </div>
          <div className="text-2xl font-bold">{imc}</div>
          <div className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full inline-block bg-stone-50", imcCategory.color)}>{imcCategory.label}</div>
        </div>
        <button 
          onClick={() => setShowWeightModal(true)}
          className="bg-white p-5 rounded-3xl border border-stone-100 card-shadow space-y-2 text-left hover:bg-stone-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-stone-400">
            <TrendingUp size={14} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Peso Actual</span>
          </div>
          <div className="text-2xl font-bold">{profile.weight} <span className="text-sm font-normal text-stone-400">kg</span></div>
          <div className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">Meta: {profile.targetWeight || '--'} kg</div>
        </button>
      </div>

      {/* Weight Chart Section */}
      {weightLogs.length > 0 && (
        <div className="bg-white p-6 rounded-[2rem] border border-stone-100 card-shadow space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Progreso de Peso</h3>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              {weightLogs.length > 1 ? `${(weightLogs[weightLogs.length-1].weight - weightLogs[0].weight).toFixed(1)}kg total` : 'Primer registro'}
            </span>
          </div>
          <WeightChart logs={weightLogs} />
        </div>
      )}

      {/* Macronutrients Chart */}
      <div className="bg-white p-6 rounded-[2rem] border border-stone-100 card-shadow space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Macronutrientes Hoy</h3>
        <MacroChart macros={macros} />
      </div>

      {/* Water Tracker */}
      <WaterTracker current={water} onAdd={onAddWater} />

      {/* Quick Activity */}
      <div className="space-y-3">
        <h3 className="font-serif italic font-bold text-lg px-2">Actividad Reciente</h3>
        <div className="bg-white rounded-[2rem] border border-stone-100 card-shadow divide-y divide-stone-50 overflow-hidden">
          <div className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                <Utensils size={18} />
              </div>
              <div>
                <div className="font-bold text-sm">Almuerzo Saludable</div>
                <div className="text-[10px] text-stone-400 uppercase font-bold tracking-wider">Hace 2 horas</div>
              </div>
            </div>
            <div className="font-mono font-bold text-sm text-stone-600">+450 kcal</div>
          </div>
          <div className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                <Dumbbell size={18} />
              </div>
              <div>
                <div className="font-bold text-sm">Running</div>
                <div className="text-[10px] text-stone-400 uppercase font-bold tracking-wider">Esta mañana</div>
              </div>
            </div>
            <div className="font-mono font-bold text-sm text-emerald-600">-320 kcal</div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showWeightModal && (
          <WeightLogModal 
            onClose={() => setShowWeightModal(false)}
            onSave={(w: number) => {
              onAddWeight(w);
              setShowWeightModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MacroChart({ macros }: { macros: { protein: number, carbs: number, fat: number } }) {
  const data = [
    { name: 'Proteína', value: macros.protein, color: '#10b981' },
    { name: 'Carbohidratos', value: macros.carbs, color: '#3b82f6' },
    { name: 'Grasas', value: macros.fat, color: '#f59e0b' },
  ];

  return (
    <div className="h-48 w-full flex items-center">
      <ResponsiveContainer width="50%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={60}
            paddingAngle={5}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-3 pl-4">
        {data.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-xs font-medium text-stone-600">{item.name}</span>
            </div>
            <span className="text-xs font-mono font-bold">{item.value}g</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WaterTracker({ current, onAdd }: { current: number, onAdd: (amount: number) => void }) {
  const goal = 2500;
  const progress = Math.min((current / goal) * 100, 100);

  return (
    <div className="bg-white p-6 rounded-[2rem] border border-stone-100 card-shadow space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Droplets className="text-blue-500" size={20} />
          <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Hidratación</h3>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{current} <span className="text-xs font-normal text-stone-400">/ {goal} ml</span></div>
        </div>
      </div>

      <div className="h-2 bg-stone-50 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          className="h-full bg-blue-500"
        />
      </div>

      <div className="flex justify-between gap-2">
        {[250, 500].map(amount => (
          <button 
            key={amount}
            onClick={() => onAdd(amount)}
            className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all active:scale-95 flex items-center justify-center gap-1"
          >
            <Plus size={14} />
            {amount}ml
          </button>
        ))}
      </div>
    </div>
  );
}

function WeightChart({ logs }: { logs: WeightLog[] }) {
  const data = logs.map(log => ({
    date: log.timestamp?.toDate ? log.timestamp.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
    weight: log.weight
  }));

  return (
    <div className="h-48 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fill: '#a8a29e' }}
            dy={10}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fill: '#a8a29e' }}
            domain={['auto', 'auto']}
          />
          <Tooltip 
            contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelStyle={{ fontWeight: 'bold', color: '#1c1917' }}
          />
          <Area 
            type="monotone" 
            dataKey="weight" 
            stroke="#10b981" 
            strokeWidth={3}
            fillOpacity={1} 
            fill="url(#colorWeight)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeightLogModal({ onClose, onSave }: { onClose: () => void, onSave: (w: number) => void }) {
  const [weight, setWeight] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] p-8 space-y-6"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-serif italic font-bold">Registrar Peso</h2>
          <button onClick={onClose} className="p-2 bg-stone-100 rounded-full">
            <Plus size={24} className="rotate-45" />
          </button>
        </div>
        <p className="text-sm text-stone-500">Mantén un seguimiento constante para ver tu progreso real a lo largo del tiempo.</p>
        <div className="space-y-4">
          <Input 
            label="Nuevo Peso (kg)" 
            type="number" 
            step="0.1"
            placeholder="0.0" 
            value={weight} 
            onChange={setWeight} 
            autoFocus
          />
        </div>
        <button 
          onClick={() => weight && onSave(Number(weight))}
          className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all"
        >
          Guardar Peso
        </button>
      </motion.div>
    </motion.div>
  );
}

function MealsView({ meals, onAdd, onDescribe, onEdit, onDelete }: { meals: Meal[], onAdd: () => void, onDescribe: () => void, onEdit: (m: Meal) => void, onDelete: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-serif italic font-bold">Tus Comidas</h2>
        <div className="flex gap-2">
          <button onClick={onDescribe} className="flex items-center gap-2 px-3 py-2 bg-stone-100 text-stone-700 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-stone-200 transition-colors">
            <MessageSquare size={14} />
            Describir
          </button>
          <button onClick={onAdd} className="p-2 bg-stone-900 text-white rounded-xl shadow-lg shadow-stone-200">
            <Plus size={20} />
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {meals.length === 0 ? (
          <div className="bg-white p-12 rounded-[2.5rem] border border-stone-100 text-center space-y-4 card-shadow">
            <div className="w-16 h-16 bg-stone-50 text-stone-300 rounded-2xl flex items-center justify-center mx-auto">
              <Utensils size={32} />
            </div>
            <p className="text-stone-400 text-sm">No hay comidas registradas hoy.</p>
          </div>
        ) : (
          meals.map(meal => (
            <div key={meal.id} className="bg-white p-4 rounded-3xl border border-stone-100 card-shadow flex justify-between items-center group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-stone-50 text-stone-400 rounded-2xl flex items-center justify-center">
                  <Utensils size={24} />
                </div>
                <div>
                  <div className="font-bold capitalize text-sm">{meal.mealType}</div>
                  <div className="text-[10px] text-stone-400 uppercase tracking-wider font-bold">{meal.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-mono font-bold text-sm">{meal.calories} kcal</div>
                  <div className="text-[9px] text-stone-400 font-bold uppercase tracking-tighter">P:{meal.protein}g C:{meal.carbs}g G:{meal.fat}g</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => onEdit(meal)} className="p-2 text-stone-300 hover:text-emerald-600 transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => onDelete(meal.id)} className="p-2 text-stone-300 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ActivityView({ activities, onAdd, onEdit, onDelete }: { activities: ActivityLog[], onAdd: () => void, onEdit: (a: ActivityLog) => void, onDelete: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-serif italic font-bold">Actividad Física</h2>
        <button onClick={onAdd} className="p-2 bg-stone-900 text-white rounded-xl">
          <Plus size={20} />
        </button>
      </div>
      <div className="space-y-4">
        {activities.map(act => (
          <div key={act.id} className="bg-white p-4 rounded-3xl border border-stone-200 flex justify-between items-center group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                <Dumbbell size={24} />
              </div>
              <div>
                <div className="font-bold">{act.activityName}</div>
                <div className="text-xs text-stone-400">{act.durationMinutes} minutos</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-mono font-bold text-emerald-600">-{act.caloriesBurned} kcal</div>
              </div>
              <div className="flex gap-1 transition-opacity">
                <button 
                  onClick={() => onEdit(act)}
                  className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => onDelete(act.id)}
                  className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanningView({ profile, planning, meals, activities, onGenerate, onAdjust }: { profile: UserProfile, planning: HealthPlan | null, meals: Meal[], activities: ActivityLog[], onGenerate: (i?: string) => Promise<void>, onAdjust: (f: string) => Promise<void> }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleGenerate = async (instructions?: string) => {
    setIsGenerating(true);
    try {
      await onGenerate(instructions);
      setFeedback('');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAdjust = async () => {
    if (!feedback.trim()) return;
    if (!planning) {
      await handleGenerate(feedback);
      return;
    }
    setIsGenerating(true);
    try {
      await onAdjust(feedback);
      setFeedback('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-serif italic font-bold">Planificación</h2>
        <button 
          onClick={() => handleGenerate()} 
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-200 disabled:opacity-50"
        >
          <Sparkles size={16} />
          {isGenerating ? 'Generando...' : planning ? 'Actualizar Plan' : 'Generar Plan'}
        </button>
      </div>

      {/* Interaction Section (Always visible) */}
      {!isGenerating && (
        <div className="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100 space-y-4">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
            <MessageSquare size={18} />
            {planning ? '¿Quieres ajustar algo?' : '¿Cómo quieres tu plan?'}
          </div>
          <p className="text-xs text-emerald-700">
            {planning 
              ? 'Pide cambios como "menos carbohidratos" o "ejercicios en casa".' 
              : 'Dime tus preferencias: "dieta vegetariana", "enfócate en fuerza", etc.'}
          </p>
          <div className="flex gap-2">
            <input 
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={planning ? "Escribe tu sugerencia..." : "Ej: Dieta keto, rutina de 20 min..."}
              className="flex-1 bg-white border border-emerald-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              onKeyDown={(e) => e.key === 'Enter' && handleAdjust()}
            />
            <button 
              onClick={handleAdjust}
              className="bg-emerald-600 text-white p-2 rounded-xl hover:bg-emerald-700 transition-all"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {!planning && !isGenerating && (
        <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
            <Sparkles size={32} />
          </div>
          <h3 className="text-xl font-bold">Tu Plan Personalizado</h3>
          <p className="text-stone-500">Usa el chat de arriba para decirme tus preferencias o pulsa el botón para un plan estándar basado en tu perfil.</p>
        </div>
      )}

      {isGenerating && (
        <div className="bg-white p-12 rounded-[2.5rem] border border-stone-200 flex flex-col items-center justify-center space-y-4">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
          />
          <p className="font-serif italic text-stone-500">Procesando con IA...</p>
        </div>
      )}

      {planning && !isGenerating && (
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Utensils size={20} className="text-emerald-600" />
              Dieta Recomendada
            </h3>
            <div className="bg-white p-6 rounded-[2rem] border border-stone-200 space-y-4">
              <MealPlanItem label="Desayuno" content={planning.diet.breakfast} />
              <MealPlanItem label="Almuerzo" content={planning.diet.lunch} />
              <MealPlanItem label="Cena" content={planning.diet.dinner} />
              <MealPlanItem label="Snacks" content={planning.diet.snacks} />
              <div className="pt-4 border-t border-stone-100">
                <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Consejos NutriAI</div>
                <ul className="space-y-1">
                  {planning.diet.tips.map((tip, i) => (
                    <li key={i} className="text-sm text-stone-600 flex items-start gap-2">
                      <span className="text-emerald-500">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Dumbbell size={20} className="text-blue-600" />
              Entrenamiento Semanal
            </h3>
            <div className="bg-white p-6 rounded-[2rem] border border-stone-200 space-y-4">
              <div className="space-y-3">
                {planning.training.routine.map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-20 font-bold text-stone-400 text-sm">{item.day}</div>
                    <div className="flex-1 text-sm text-stone-700">{item.activity}</div>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-stone-100">
                <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Recomendaciones</div>
                <ul className="space-y-1">
                  {planning.training.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-stone-600 flex items-start gap-2">
                      <span className="text-blue-500">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function NearbyView() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ text: string, places: NearbyPlace[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = (query: string) => {
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await searchNearbyPlaces(query, position.coords.latitude, position.coords.longitude);
          setResults(res);
        } catch (err) {
          setError("Error al buscar lugares cercanos.");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError("No se pudo obtener tu ubicación. Asegúrate de dar permisos.");
        setLoading(false);
      }
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-serif italic font-bold">Cerca de ti</h2>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => handleSearch("Gimnasios saludables y centros de fitness")} className="p-4 bg-white rounded-3xl border border-stone-200 flex flex-col items-center gap-2 hover:bg-emerald-50 transition-colors">
          <Dumbbell className="text-blue-600" />
          <span className="text-xs font-bold">Gimnasios</span>
        </button>
        <button onClick={() => handleSearch("Restaurantes de comida saludable y ensaladas")} className="p-4 bg-white rounded-3xl border border-stone-200 flex flex-col items-center gap-2 hover:bg-emerald-50 transition-colors">
          <Utensils className="text-emerald-600" />
          <span className="text-xs font-bold">Comida Sana</span>
        </button>
        <button onClick={() => handleSearch("Parques y áreas recreativas para hacer ejercicio")} className="p-4 bg-white rounded-3xl border border-stone-200 flex flex-col items-center gap-2 hover:bg-emerald-50 transition-colors">
          <MapPin className="text-amber-600" />
          <span className="text-xs font-bold">Parques</span>
        </button>
        <button onClick={() => handleSearch("Tiendas de suplementos y nutrición")} className="p-4 bg-white rounded-3xl border border-stone-200 flex flex-col items-center gap-2 hover:bg-emerald-50 transition-colors">
          <Sparkles className="text-purple-600" />
          <span className="text-xs font-bold">Nutrición</span>
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-12 space-y-4">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
          />
          <p className="text-stone-500 italic">Buscando en Google Maps...</p>
        </div>
      )}

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm">{error}</div>}

      {results && !loading && (
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-[2rem] border border-stone-200 space-y-4">
            <p className="text-sm text-stone-600">{results.text}</p>
            <div className="space-y-2">
              {results.places.map((place, i) => (
                <a 
                  key={i} 
                  href={place.uri} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 bg-stone-50 rounded-xl hover:bg-stone-100 transition-colors"
                >
                  <span className="text-sm font-bold text-stone-800">{place.title}</span>
                  <ChevronRight size={16} className="text-stone-400" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MealPlanItem({ label, content }: { label: string, content: string }) {
  return (
    <div>
      <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">{label}</div>
      <div className="text-stone-700">{content}</div>
    </div>
  );
}

function ProfileView({ profile }: { profile: UserProfile }) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-serif italic font-bold">Tu Perfil</h2>
      <div className="bg-white rounded-[2rem] border border-stone-200 overflow-hidden">
        <div className="p-6 bg-stone-900 text-white flex items-center gap-4">
          <div className="w-16 h-16 bg-stone-800 rounded-2xl flex items-center justify-center">
            <UserIcon size={32} />
          </div>
          <div>
            <div className="text-xl font-bold">{profile.displayName}</div>
            <div className="text-stone-400 text-sm">{profile.goal === 'lose' ? 'Perder peso' : profile.goal === 'gain' ? 'Ganar músculo' : 'Mantenimiento'}</div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <ProfileItem label="Edad" value={`${profile.age} años`} />
          <ProfileItem label="Altura" value={`${profile.height} cm`} />
          <ProfileItem label="Peso" value={`${profile.weight} kg`} />
          <ProfileItem label="Actividad" value={profile.activityLevel} />
        </div>
      </div>
    </div>
  );
}

// --- UI Components ---

function NavButton({ active, icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all",
        active ? "text-emerald-600" : "text-stone-400"
      )}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Input({ label, onChange, value, ...props }: any) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">{label}</label>
      <input 
        className="w-full bg-white border border-stone-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
        value={value ?? ''}
        onChange={(e) => onChange && onChange(e.target.value)}
        {...props}
      />
    </div>
  );
}

function Select({ label, options, onChange, value }: any) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">{label}</label>
      <select 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-stone-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all appearance-none"
      >
        {options.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function ProfileItem({ label, value }: any) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-stone-50 last:border-0">
      <span className="text-stone-400 text-sm">{label}</span>
      <span className="font-bold capitalize">{value}</span>
    </div>
  );
}

function CameraModal({ onClose, onEstimate, isEstimating }: any) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (err) {
        console.error(err);
      }
    }
    startCamera();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx?.drawImage(videoRef.current, 0, 0);
      const data = canvasRef.current.toDataURL('image/jpeg');
      onEstimate(data);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black z-50 flex flex-col"
    >
      <div className="flex-1 relative">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        
        <button onClick={onClose} className="absolute top-6 left-6 text-white p-2 bg-black/20 rounded-full backdrop-blur-md">
          <Plus size={24} className="rotate-45" />
        </button>

        {isEstimating && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white space-y-4">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
            />
            <p className="font-serif italic text-xl">Analizando tu plato...</p>
          </div>
        )}
      </div>

      <div className="bg-stone-900 p-10 flex justify-center items-center">
        <button 
          disabled={isEstimating}
          onClick={capture}
          className="w-20 h-20 bg-white rounded-full border-8 border-stone-800 active:scale-90 transition-all flex items-center justify-center"
        >
          <div className="w-14 h-14 bg-emerald-600 rounded-full" />
        </button>
      </div>
    </motion.div>
  );
}

function ActivityModal({ onClose, onSave, initialData }: { onClose: () => void, onSave: (a: Omit<ActivityLog, 'id' | 'timestamp'>) => void, initialData?: ActivityLog }) {
  const [name, setName] = useState(initialData?.activityName || '');
  const [duration, setDuration] = useState(initialData?.durationMinutes.toString() || '');
  const [calories, setCalories] = useState(initialData?.caloriesBurned.toString() || '');
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (name.length > 3 && duration && !calories) {
        setIsCalculating(true);
        try {
          const estimated = await estimateActivityCalories(name, Number(duration));
          if (estimated > 0) setCalories(estimated.toString());
        } finally {
          setIsCalculating(false);
        }
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [name, duration]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] p-8 space-y-6"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-serif italic font-bold">Registrar Deporte</h2>
          <button onClick={onClose} className="p-2 bg-stone-100 rounded-full">
            <Plus size={24} className="rotate-45" />
          </button>
        </div>

        <div className="space-y-4">
          <Input 
            label="Actividad" 
            placeholder="Ej: Running, Natación..." 
            value={name} 
            onChange={setName} 
          />
          <div className="grid grid-cols-2 gap-4">
            <Input 
              label="Duración (min)" 
              type="number" 
              value={duration} 
              onChange={setDuration} 
            />
            <div className="relative">
              <Input 
                label="Calorías Quemadas" 
                type="number" 
                value={calories} 
                onChange={setCalories} 
              />
              {isCalculating && (
                <div className="absolute right-3 bottom-3">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full"
                  />
                </div>
              )}
            </div>
          </div>
          {name.length > 3 && duration && !calories && !isCalculating && (
            <p className="text-[10px] text-stone-400 italic">NutriAI estimará las calorías automáticamente...</p>
          )}
        </div>

        <button 
          onClick={() => {
            if (name && duration && calories) {
              onSave({
                activityName: name,
                durationMinutes: Number(duration),
                caloriesBurned: Number(calories)
              });
            }
          }}
          disabled={isCalculating}
          className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all disabled:opacity-50"
        >
          {isCalculating ? 'Calculando...' : 'Guardar Actividad'}
        </button>
      </motion.div>
    </motion.div>
  );
}

function MealModal({ onClose, onSave, initialData }: { onClose: () => void, onSave: (m: Omit<Meal, 'id' | 'timestamp'>) => void, initialData?: Meal }) {
  const [description, setDescription] = useState(initialData?.description || '');
  const [mealType, setMealType] = useState(initialData?.mealType || 'snack');
  const [calories, setCalories] = useState(initialData?.calories.toString() || '');
  const [protein, setProtein] = useState(initialData?.protein.toString() || '');
  const [carbs, setCarbs] = useState(initialData?.carbs.toString() || '');
  const [fat, setFat] = useState(initialData?.fat.toString() || '');
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEstimate = async () => {
    if (description.length < 3) return;
    setIsCalculating(true);
    setError(null);
    
    // Create a controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      setIsCalculating(false);
      setError("La IA está tardando demasiado. Intenta de nuevo.");
    }, 20000); // 20 seconds timeout

    try {
      const est = await estimateMealCalories(description);
      clearTimeout(timeoutId);
      setCalories(est.calories.toString());
      setProtein(est.protein.toString());
      setCarbs(est.carbs.toString());
      setFat(est.fat.toString());
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return;
      console.error(err);
      setError("No se pudo estimar. Intenta ser más específico.");
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] p-8 space-y-6"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-serif italic font-bold">Registrar Comida</h2>
          <button onClick={onClose} className="p-2 bg-stone-100 rounded-full">
            <Plus size={24} className="rotate-45" />
          </button>
        </div>

        <div className="space-y-4">
          <Select 
            label="Tipo de Comida" 
            value={mealType} 
            options={[
              {v: 'breakfast', l: 'Desayuno'},
              {v: 'lunch', l: 'Almuerzo'},
              {v: 'dinner', l: 'Cena'},
              {v: 'snack', l: 'Snack'}
            ]} 
            onChange={setMealType} 
          />
          <div className="space-y-1">
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Descripción</label>
            <div className="relative">
              <textarea 
                className="w-full bg-white border border-stone-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all min-h-[80px]"
                placeholder="Ej: Ensalada de pollo con aguacate y nueces..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <button 
                onClick={handleEstimate}
                disabled={isCalculating || description.length < 3}
                className="absolute right-2 bottom-2 p-2 bg-emerald-600 text-white rounded-lg shadow-lg shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 transition-all"
                title="Estimar con IA"
              >
                {isCalculating ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Sparkles size={16} />
                )}
              </button>
            </div>
            {error && <p className="text-[10px] text-red-500 font-bold">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Calorías" type="number" value={calories} onChange={setCalories} />
            <Input label="Proteína (g)" type="number" value={protein} onChange={setProtein} />
            <Input label="Carbohidratos (g)" type="number" value={carbs} onChange={setCarbs} />
            <Input label="Grasas (g)" type="number" value={fat} onChange={setFat} />
          </div>
        </div>

        <button 
          onClick={() => {
            if (description && calories) {
              onSave({
                mealType,
                description,
                calories: Number(calories),
                protein: Number(protein) || 0,
                carbs: Number(carbs) || 0,
                fat: Number(fat) || 0
              });
            }
          }}
          className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all"
        >
          Guardar Comida
        </button>
      </motion.div>
    </motion.div>
  );
}
