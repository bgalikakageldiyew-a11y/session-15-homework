-- Logical database design for recipes

-- Table: recipes

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,            -- optional short summary
  ingredients TEXT NOT NULL,   -- multi-line text, one ingredient per line
  steps TEXT NOT NULL,         -- multi-line text, numbered or free-form steps
  tags TEXT                    -- comma-separated tags, e.g. "quick, vegetarian"
);

-- Example row matching the current JSON structure
INSERT INTO recipes (id, title, description, ingredients, steps, tags) VALUES (
  1,
  'Example recipe title',
  'Short human-friendly summary of the recipe',
  '- 200 g pasta\n- 2 ripe tomatoes\n- 1 garlic clove',
  '1. Boil pasta\n2. Prepare the sauce\n3. Combine and serve',
  'quick, vegetarian, pasta'
);

