import { supabase } from './supabase';

// Types
export interface FoodProduct {
  name: string;
  brand: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sugar?: number;
  image_url: string;
  off_id?: string;
}

export interface MealItem {
  id?: string;
  meal_id: string;
  product_name: string;
  brand?: string;
  quantity_grams: number;
  energy_kcal_100g: number;
  protein_100g: number;
  fat_100g: number;
  carbs_100g: number;
  image_url?: string;
  created_at?: string;
}

export interface Meal {
  id?: string;
  name: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  created_at?: string;
  items?: MealItem[];
}

export interface NutritionSummary {
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  meals: Meal[];
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cache for search results to avoid repeated API calls
const searchCache: Record<string, { timestamp: number, results: FoodProduct[] }> = {};
const CACHE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

/**
 * Search for products by name using Supabase Edge Function
 * @param query The search query
 * @returns Array of product information
 */
export async function searchProductsByName(query: string): Promise<FoodProduct[]> {
  // Check cache first
  const cacheKey = query.toLowerCase().trim();
  const cachedResult = searchCache[cacheKey];
  const now = Date.now();
  
  if (cachedResult && (now - cachedResult.timestamp < CACHE_EXPIRATION)) {
    console.log(`Using cached results for query: ${query}`);
    return cachedResult.results;
  }
  
  const maxRetries = 2;
  const baseDelay = 300; // Start with 300ms delay

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Searching for products with query: ${query} (attempt ${attempt})`);
      
      // First try to search in local database
      const { data: localData, error: localError } = await supabase
        .from('food_database')
        .select('*')
        .ilike('name', `%${query}%`)
        .limit(10);
        
      if (!localError && localData && localData.length > 0) {
        console.log(`Found ${localData.length} results in local database`);
        const results = localData.map(item => ({
          name: item.name,
          brand: item.brand || '',
          calories: item.kcal_per_100g || 0,
          protein: item.protein_per_100g || 0,
          fat: item.fat_per_100g || 0,
          carbs: item.carbs_per_100g || 0,
          image_url: item.image_url || '',
          off_id: item.id.toString()
        }));
        
        // Cache the results
        searchCache[cacheKey] = { timestamp: now, results };
        return results;
      }
      
      // If not found locally, call the Edge Function
      const { data, error } = await supabase.functions.invoke('food-search', {
        body: { query }
      });
      
      if (error) {
        // If it's a 404, return empty array instead of throwing
        if (error.status === 404) {
          return [];
        }
        throw new Error(`Sökningen misslyckades: ${error.message}`);
      }
      
      if (!data || !Array.isArray(data)) {
        throw new Error('Ogiltig respons från servern');
      }
      
      // Cache the results
      const results = data.map(item => ({
        name: item.name,
        brand: item.brand || '',
        calories: item.calories || 0,
        protein: item.protein || 0,
        fat: item.fat || 0,
        carbs: item.carbs || 0,
        sugar: item.sugar,
        image_url: item.image_url || '',
        off_id: item.off_id || item.barcode || generateTempId(item.name, item.brand)
      }));
      
      searchCache[cacheKey] = { timestamp: now, results };
      return results;
    } catch (err: any) {
      console.error(`Error searching products (attempt ${attempt}):`, err);
      
      // If this is our last attempt, throw the error
      if (attempt === maxRetries) {
        if (err.message && err.message.includes('404')) {
          return []; // Return empty array for no results
        } else if (err.message && (
          err.message.includes('Network') || 
          err.message.includes('Failed to fetch') ||
          err.message.includes('HTTP error') ||
          err.message.includes('timeout')
        )) {
          throw new Error('Kunde inte ansluta till servern. Kontrollera din internetanslutning och försök igen.');
        }
        throw new Error(err.message || 'Ett fel uppstod vid sökning. Försök igen om en stund.');
      }
      
      // Calculate wait time with exponential backoff and jitter
      const jitter = Math.random() * 200; // Add up to 200ms of random jitter
      const waitTime = baseDelay * Math.pow(2, attempt - 1) + jitter;
      console.log(`Retry attempt ${attempt} failed, waiting ${Math.round(waitTime)}ms before next attempt`);
      await delay(waitTime);
    }
  }

  // This should never be reached due to the throw in the last iteration
  return [];
}

/**
 * Cache search results in the livsmedelskache table
 */
async function cacheSearchResults(products: any[]) {
  try {
    for (const product of products) {
      if (!product.off_id && !product.barcode) continue;
      
      const off_id = product.off_id || product.barcode;
      
      // Check if product already exists in cache
      const { data: existingProduct } = await supabase
        .from('livsmedelskache')
        .select('off_id')
        .eq('off_id', off_id)
        .maybeSingle();
        
      if (existingProduct) continue; // Skip if already cached
      
      // Insert into cache
      await supabase
        .from('livsmedelskache')
        .insert({
          off_id: off_id,
          produktnamn: product.name,
          varumarke: product.brand || null,
          energi_kcal_100g: product.calories || 0,
          protein_100g: product.protein || 0,
          kolhydrater_100g: product.carbs || 0,
          fett_100g: product.fat || 0,
          bild_url: product.image_url || null
        });
    }
  } catch (error) {
    console.error('Error caching search results:', error);
    // Continue execution even if caching fails
  }
}

/**
 * Generate a temporary ID for products without an OFF ID
 */
function generateTempId(name: string, brand: string): string {
  const combinedString = `${name}${brand || ''}${Date.now()}`;
  return `temp_${combinedString.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)}`;
}

/**
 * Lookup a product by barcode using Open Food Facts API
 * @param barcode The EAN barcode to lookup
 * @returns Product information or error
 */
export async function lookupProductByBarcode(barcode: string): Promise<FoodProduct> {
  try {
    // First check if we have it in our local database
    const { data: localData, error: localError } = await supabase
      .from('food_database')
      .select('*')
      .eq('barcode', barcode)
      .maybeSingle();
      
    if (!localError && localData) {
      return {
        name: localData.name,
        brand: localData.brand || '',
        calories: localData.kcal_per_100g || 0,
        protein: localData.protein_per_100g || 0,
        fat: localData.fat_per_100g || 0,
        carbs: localData.carbs_per_100g || 0,
        image_url: localData.image_url || '',
        off_id: localData.id.toString()
      };
    }
    
    // Direct API call to Open Food Facts instead of using the edge function
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      {
        headers: {
          'User-Agent': 'HeavyGym - Mobile App - Version 1.0 - https://heavygym.app'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to lookup product');
    }
    
    const data = await response.json();
    
    // Check if product was found
    if (data.status !== 1 || !data.product) {
      throw new Error('Produkten hittades inte.');
    }

    const product = data.product;
    const nutrients = product.nutriments || {};

    // Extract and format the required data
    return {
      name: product.product_name || "Unknown Product",
      brand: product.brands || "Unknown Brand",
      calories: nutrients["energy-kcal_100g"] || nutrients["energy-kcal"] || 0,
      protein: nutrients.proteins_100g || 0,
      fat: nutrients.fat_100g || 0,
      carbs: nutrients.carbohydrates_100g || 0,
      sugar: nutrients.sugars_100g || 0,
      image_url: product.image_url || "",
    };
  } catch (error) {
    console.error('Error looking up product:', error);
    throw error;
  }
}

/**
 * Calculate nutrition values based on product and quantity
 * @param product The food product
 * @param quantityGrams The quantity in grams
 * @returns Calculated nutrition values
 */
export function calculateNutrition(product: FoodProduct, quantityGrams: number) {
  return {
    calories: Math.round((product.calories * quantityGrams) / 100),
    protein: Math.round((product.protein * quantityGrams) / 100),
    carbs: Math.round((product.carbs * quantityGrams) / 100),
    fat: Math.round((product.fat * quantityGrams) / 100),
  };
}

/**
 * Create a new meal
 * @param mealName The name of the meal
 * @returns The created meal
 */
export async function createMeal(mealName: string): Promise<Meal> {
  try {
    const { data, error } = await supabase
      .from('meals')
      .insert({
        name: mealName,
        total_calories: 0,
        total_protein: 0,
        total_carbs: 0,
        total_fat: 0,
        log_date: new Date().toISOString().split('T')[0]
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating meal:', error);
    throw error;
  }
}

/**
 * Add a food item to a meal
 * @param mealId The ID of the meal
 * @param product The food product
 * @param quantityGrams The quantity in grams
 * @returns The created meal item
 */
export async function addFoodToMeal(
  mealId: string,
  product: FoodProduct,
  quantityGrams: number
): Promise<MealItem> {
  try {
    const { data, error } = await supabase
      .from('meal_items')
      .insert({
        meal_id: mealId,
        product_name: product.name,
        brand: product.brand,
        quantity_grams: quantityGrams,
        energy_kcal_100g: product.calories,
        protein_100g: product.protein,
        fat_100g: product.fat,
        carbs_100g: product.carbs,
        image_url: product.image_url,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error adding food to meal:', error);
    throw error;
  }
}

/**
 * Get meal details with all items
 * @param mealId The ID of the meal
 * @returns The meal with all items
 */
export async function getMealWithItems(mealId: string): Promise<Meal> {
  try {
    const { data, error } = await supabase
      .rpc('get_meal_with_items', { p_meal_id: mealId });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting meal with items:', error);
    throw error;
  }
}

/**
 * Get daily nutrition summary
 * @param date Optional date (defaults to today)
 * @returns Nutrition summary for the day
 */
export async function getDailyNutritionSummary(date?: Date): Promise<NutritionSummary> {
  try {
    const formattedDate = date ? date.toISOString().split('T')[0] : undefined;
    
    const { data, error } = await supabase
      .rpc('get_daily_nutrition_summary_for_meals', {
        p_date: formattedDate
      });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting daily nutrition summary:', error);
    throw error;
  }
}

/**
 * Delete a meal item
 * @param itemId The ID of the meal item
 */
export async function deleteMealItem(itemId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('meal_items')
      .delete()
      .eq('id', itemId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting meal item:', error);
    throw error;
  }
}

/**
 * Delete a meal and all its items
 * @param mealId The ID of the meal
 */
export async function deleteMeal(mealId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('meals')
      .delete()
      .eq('id', mealId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting meal:', error);
    throw error;
  }
}

/**
 * Update a meal item's quantity
 * @param itemId The ID of the meal item
 * @param quantityGrams The new quantity in grams
 */
export async function updateMealItemQuantity(
  itemId: string,
  quantityGrams: number
): Promise<void> {
  try {
    const { error } = await supabase
      .from('meal_items')
      .update({ quantity_grams: quantityGrams })
      .eq('id', itemId);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating meal item quantity:', error);
    throw error;
  }
}

/**
 * Update a meal's name
 * @param mealId The ID of the meal
 * @param name The new name
 */
export async function updateMealName(
  mealId: string,
  name: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('meals')
      .update({ name })
      .eq('id', mealId);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating meal name:', error);
    throw error;
  }
}

/**
 * Get all meals for a specific date
 * @param date The date to get meals for
 * @returns List of meals for the date
 */
export async function getMealsByDate(date: Date): Promise<Meal[]> {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('log_date', date.toISOString().split('T')[0])
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting meals by date:', error);
    throw error;
  }
}