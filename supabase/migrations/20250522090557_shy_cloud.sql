/*
  # Add trigger to automatically delete empty meal logs
  
  1. Changes
    - Create a trigger to delete daily_meal_logs when the last meal_entry is removed
    - Update the update_meal_log_totals function to handle this case
    - Ensure proper cleanup of empty meal logs
*/

-- First, modify the update_meal_log_totals function to delete empty meal logs
CREATE OR REPLACE FUNCTION update_meal_log_totals()
RETURNS TRIGGER AS $$
DECLARE
  log_user_id uuid;
  entry_count integer;
BEGIN
  -- Get the meal log's user_id
  SELECT user_id INTO log_user_id
  FROM daily_meal_logs
  WHERE id = COALESCE(NEW.daily_log_id, OLD.daily_log_id);
  
  -- Count remaining entries for this meal log
  SELECT COUNT(*) INTO entry_count
  FROM meal_entries
  WHERE daily_log_id = COALESCE(NEW.daily_log_id, OLD.daily_log_id);
  
  -- If this is a DELETE operation and there are no more entries, delete the meal log
  IF TG_OP = 'DELETE' AND entry_count = 0 THEN
    DELETE FROM daily_meal_logs
    WHERE id = OLD.daily_log_id;
    
    -- Return early since the meal log is deleted
    RETURN OLD;
  END IF;
  
  -- Otherwise, update meal log totals as before
  UPDATE daily_meal_logs
  SET 
    total_calories = COALESCE((
      SELECT SUM(calories)
      FROM meal_entries
      WHERE daily_log_id = COALESCE(NEW.daily_log_id, OLD.daily_log_id)
    ), 0),
    total_protein = COALESCE((
      SELECT SUM(protein)
      FROM meal_entries
      WHERE daily_log_id = COALESCE(NEW.daily_log_id, OLD.daily_log_id)
    ), 0),
    total_carbs = COALESCE((
      SELECT SUM(carbs)
      FROM meal_entries
      WHERE daily_log_id = COALESCE(NEW.daily_log_id, OLD.daily_log_id)
    ), 0),
    total_fat = COALESCE((
      SELECT SUM(fat)
      FROM meal_entries
      WHERE daily_log_id = COALESCE(NEW.daily_log_id, OLD.daily_log_id)
    ), 0),
    updated_at = now()
  WHERE id = COALESCE(NEW.daily_log_id, OLD.daily_log_id);
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_meal_log_totals_insert_update ON meal_entries;
DROP TRIGGER IF EXISTS update_meal_log_totals_delete ON meal_entries;

-- Create triggers for meal_entries
CREATE TRIGGER update_meal_log_totals_insert_update
  AFTER INSERT OR UPDATE ON meal_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_meal_log_totals();

CREATE TRIGGER update_meal_log_totals_delete
  AFTER DELETE ON meal_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_meal_log_totals();

-- Force schema cache refresh
NOTIFY pgrst, 'reload schema';