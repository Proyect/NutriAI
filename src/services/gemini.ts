import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface FoodEstimation {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  description: string;
}

const parseJSONResponse = (text: string) => {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (e) {
    try {
      // Fallback: Remove markdown code blocks if present
      const cleanText = text.replace(/```json\n?|```/g, "").trim();
      return JSON.parse(cleanText);
    } catch (e2) {
      console.error("Failed to parse Gemini JSON:", text);
      throw new Error("Invalid response format from AI");
    }
  }
};

export const estimateCaloriesFromImage = async (base64Image: string): Promise<FoodEstimation> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Analiza esta imagen de comida. Estima las calorías totales y macronutrientes (proteína, carbohidratos, grasas).`;

  const imagePart = {
    inlineData: {
      mimeType: "image/jpeg",
      data: base64Image.split(",")[1] || base64Image,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }, imagePart] }],
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            calories: { type: Type.NUMBER },
            protein: { type: Type.NUMBER },
            carbs: { type: Type.NUMBER },
            fat: { type: Type.NUMBER },
            description: { type: Type.STRING }
          },
          required: ["calories", "protein", "carbs", "fat", "description"]
        }
      }
    });

    return parseJSONResponse(response.text);
  } catch (error) {
    console.error("Error estimating calories:", error);
    throw error;
  }
};

export const estimateMealCalories = async (description: string): Promise<FoodEstimation> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Analiza esta descripción de comida: "${description}". Estima las calorías totales y macronutrientes.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            calories: { type: Type.NUMBER },
            protein: { type: Type.NUMBER },
            carbs: { type: Type.NUMBER },
            fat: { type: Type.NUMBER },
            description: { type: Type.STRING }
          },
          required: ["calories", "protein", "carbs", "fat", "description"]
        }
      }
    });

    return parseJSONResponse(response.text);
  } catch (error) {
    console.error("Error estimating meal calories:", error);
    throw error;
  }
};

export const estimateActivityCalories = async (activity: string, durationMinutes: number): Promise<number> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Calcula las calorías quemadas para: "${activity}" durante ${durationMinutes} minutos.
  Responde solo con el número entero.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    });

    const text = response.text;
    const calories = parseInt(text.replace(/[^0-9]/g, ''));
    return isNaN(calories) ? 0 : calories;
  } catch (error) {
    console.error("Error estimating activity calories:", error);
    return 0;
  }
};

export interface HealthPlan {
  diet: {
    breakfast: string;
    lunch: string;
    dinner: string;
    snacks: string;
    tips: string[];
  };
  training: {
    routine: { day: string; activity: string }[];
    recommendations: string[];
  };
}

export const generateHealthPlan = async (profile: any, meals: any[] = [], activities: any[] = [], instructions?: string): Promise<HealthPlan> => {
  const model = "gemini-3-flash-preview";
  
  const historySummary = `
  Historial reciente:
  - Comidas: ${meals.map(m => `${m.mealType}: ${m.description} (${m.calories}kcal)`).join(", ")}
  - Actividades: ${activities.map(a => `${a.activityName}: ${a.durationMinutes}min (${a.caloriesBurned}kcal)`).join(", ")}
  `;

  const prompt = `Como nutricionista y entrenador personal, crea un plan optimizado para:
  - Perfil: ${profile.age} años, ${profile.gender}, ${profile.weight}kg, ${profile.height}cm.
  - Estilo de vida: ${profile.activityLevel}, trabajo ${profile.workType}.
  - Objetivo: ${profile.goal}.
  
  ${meals.length > 0 || activities.length > 0 ? historySummary : ""}
  ${instructions ? `Instrucciones adicionales del usuario: "${instructions}"` : ""}

  Analiza el historial del usuario y sus instrucciones para identificar patrones y ajustar las recomendaciones.
  Responde ÚNICAMENTE en JSON:
  {
    "diet": {
      "breakfast": "...",
      "lunch": "...",
      "dinner": "...",
      "snacks": "...",
      "tips": ["..."]
    },
    "training": {
      "routine": [{"day": "Lunes", "activity": "..."}],
      "recommendations": ["..."]
    }
  }`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    return parseJSONResponse(response.text);
  } catch (error) {
    console.error("Error generating health plan:", error);
    throw error;
  }
};

export const adjustHealthPlan = async (currentPlan: HealthPlan, feedback: string, profile: any, meals: any[] = [], activities: any[] = []): Promise<HealthPlan> => {
  const model = "gemini-3-flash-preview";
  
  const historySummary = `
  Historial reciente:
  - Comidas: ${meals.map(m => `${m.mealType}: ${m.description} (${m.calories}kcal)`).join(", ")}
  - Actividades: ${activities.map(a => `${a.activityName}: ${a.durationMinutes}min (${a.caloriesBurned}kcal)`).join(", ")}
  `;

  const prompt = `El usuario tiene el siguiente plan de salud:
  ${JSON.stringify(currentPlan)}

  Perfil del usuario: ${profile.age} años, ${profile.gender}, ${profile.weight}kg, ${profile.goal}.
  
  ${meals.length > 0 || activities.length > 0 ? historySummary : ""}

  El usuario solicita el siguiente ajuste o mejora: "${feedback}".

  Modifica el plan original integrando estas sugerencias y considerando su historial de actividad real.
  Responde ÚNICAMENTE en JSON con la estructura completa:
  {
    "diet": { ... },
    "training": { ... }
  }`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    return parseJSONResponse(response.text);
  } catch (error) {
    console.error("Error adjusting health plan:", error);
    throw error;
  }
};

export interface NearbyPlace {
  title: string;
  uri: string;
}

export const searchNearbyPlaces = async (query: string, lat: number, lng: number): Promise<{ text: string, places: NearbyPlace[] }> => {
  const model = "gemini-2.5-flash";
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: query }] }],
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      },
    });

    const text = response.text || "Aquí tienes algunos lugares cercanos:";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    const places: NearbyPlace[] = chunks
      .filter((chunk: any) => chunk.maps?.uri)
      .map((chunk: any) => ({
        title: chunk.maps.title,
        uri: chunk.maps.uri
      }));

    return { text, places };
  } catch (error) {
    console.error("Error searching nearby places:", error);
    throw error;
  }
};
