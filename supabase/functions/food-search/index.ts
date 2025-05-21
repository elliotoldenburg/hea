import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface SearchResult {
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse the request body to get the search query
    const { query } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Search query parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch products from Open Food Facts API
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10`,
      {
        headers: {
          'User-Agent': 'HeavyGym - Supabase Edge Function - Version 1.0 - https://heavygym.app'
        },
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(5000)
      }
    );

    if (!response.ok) {
      console.error(`Open Food Facts API error: ${response.status} ${response.statusText}`);
      
      // Return a more detailed error response
      return new Response(
        JSON.stringify({ 
          error: `Failed to fetch from Open Food Facts API: ${response.statusText}`,
          status: response.status
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();

    // Check if products were found
    if (!data.products || data.products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Inga produkter hittades." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Process and format the results
    const results: SearchResult[] = data.products
      .filter((product: any) => {
        const nutrients = product.nutriments || {};
        // Filter out products without basic nutritional information
        return (
          product.product_name &&
          (nutrients["energy-kcal_100g"] || nutrients["energy-kcal"]) !== undefined &&
          nutrients.proteins_100g !== undefined &&
          nutrients.fat_100g !== undefined &&
          nutrients.carbohydrates_100g !== undefined
        );
      })
      .map((product: any) => {
        const nutrients = product.nutriments || {};
        const calories = nutrients["energy-kcal_100g"] || nutrients["energy-kcal"] || 0;
        
        return {
          name: product.product_name || "Okänd produkt",
          brand: product.brands || "Okänt varumärke",
          calories: Math.max(0, Math.round(calories)),
          protein: Math.max(0, Math.round(nutrients.proteins_100g || 0)),
          fat: Math.max(0, Math.round(nutrients.fat_100g || 0)),
          carbs: Math.max(0, Math.round(nutrients.carbohydrates_100g || 0)),
          sugar: Math.max(0, Math.round(nutrients.sugars_100g || 0)),
          image_url: product.image_url || "",
          off_id: product.id || product.code || null
        };
      })
      .filter((product: SearchResult) => 
        // Additional validation to ensure we have valid nutritional values
        product.calories > 0 &&
        product.protein >= 0 &&
        product.fat >= 0 &&
        product.carbs >= 0
      );

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing request:", error);
    
    // Determine if it's a timeout error
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeoutError = errorMessage.includes("timeout") || errorMessage.includes("abort");
    
    return new Response(
      JSON.stringify({ 
        error: isTimeoutError 
          ? "Sökningen tog för lång tid. Försök igen eller använd en mer specifik sökterm." 
          : "Ett fel uppstod vid sökning av produktinformation. Försök igen om en stund.",
        details: errorMessage
      }),
      {
        status: isTimeoutError ? 504 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});