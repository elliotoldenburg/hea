-- Create or replace the upsert_meal_entry function to correctly handle meal entries
CREATE OR REPLACE FUNCTION upsert_meal_entry(
  p_user_id uuid,
  p_date date,
  p_meal_type text,
  p_product_id text,
  p_product_name text,
  p_quantity_grams numeric,
  p_calories_total numeric,
  p_protein_total numeric,
  p_carbs_total numeric,
  p_fat_total numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_meal_log_id uuid;
  v_entry_id uuid;
BEGIN
  -- Get or create meal log
  SELECT id INTO v_meal_log_id
  FROM daily_meal_logs
  WHERE user_id = p_user_id AND log_date = p_date AND meal_type = p_meal_type;
  
  IF v_meal_log_id IS NULL THEN
    INSERT INTO daily_meal_logs (user_id, log_date, meal_type)
    VALUES (p_user_id, p_date, p_meal_type)
    RETURNING id INTO v_meal_log_id;
  END IF;
  
  -- Insert meal entry
  INSERT INTO meal_entries (
    meal_log_id,
    product_id,
    food_name,
    quantity,
    calories,
    protein,
    carbs,
    fat
  ) VALUES (
    v_meal_log_id,
    p_product_id,
    p_product_name,
    p_quantity_grams,
    p_calories_total,
    p_protein_total,
    p_carbs_total,
    p_fat_total
  )
  RETURNING id INTO v_entry_id;
  
  RETURN v_entry_id;
END;
$$;

-- Force schema cache refresh
NOTIFY pgrst, 'reload schema';