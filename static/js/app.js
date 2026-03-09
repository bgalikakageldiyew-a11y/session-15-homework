(() => {
  const listEl = document.getElementById("recipesList");
  const emptyStateEl = document.getElementById("emptyState");
  const searchEl = document.getElementById("search");
  const formEl = document.getElementById("recipeForm");
  const idEl = document.getElementById("recipeId");
  const titleEl = document.getElementById("title");
  const descriptionEl = document.getElementById("description");
  const ingredientsEl = document.getElementById("ingredients");
  const stepsEl = document.getElementById("steps");
  const tagsEl = document.getElementById("tags");
  const resetBtn = document.getElementById("resetForm");
  const toastEl = document.getElementById("toast");
  const themeBtn = document.getElementById("toggleTheme");
  const randomBtn = document.getElementById("addRandomRecipe");
  const saveBtn = formEl ? formEl.querySelector("button[type=submit]") : null;

  let recipes = [];
  let filter = "";
  let toastTimeout = null;

  const withLoading = (isLoading) => {
    if (!saveBtn) return;
    if (isLoading) {
      saveBtn.classList.add("loading");
      saveBtn.disabled = true;
    } else {
      saveBtn.classList.remove("loading");
      saveBtn.disabled = false;
    }
  };

  const showToast = (message) => {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove("visible");
    }, 2200);
  };

  const applyTheme = (theme) => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("theme-light");
    } else {
      root.classList.remove("theme-light");
    }
  };

  const initTheme = () => {
    const saved = window.localStorage.getItem("recipe-theme");
    const prefersLight =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    const theme = saved || (prefersLight ? "light" : "dark");
    applyTheme(theme);
  };

  const toggleTheme = () => {
    const isLight = document.documentElement.classList.contains("theme-light");
    const next = isLight ? "dark" : "light";
    applyTheme(next);
    window.localStorage.setItem("recipe-theme", next);
  };

  const escapeHtml = (str) => {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  const getFilteredRecipes = () => {
    const term = filter.trim().toLowerCase();
    if (!term) return recipes;
    return recipes.filter((recipe) => {
      const searchableContent = [
        recipe.title,
        recipe.description,
        recipe.ingredients,
        recipe.steps,
        ...(recipe.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return searchableContent.includes(term);
    });
  };

  const createRecipeListItem = (recipe) => {
    const listItem = document.createElement("li");
    listItem.className = "recipe-card";
    listItem.dataset.id = recipe.id;

    const recipeTags = (recipe.tags || [])
      .map((tagValue) => `<span class="tag">${tagValue}</span>`)
      .join("");

    listItem.innerHTML = `
        <div class="recipe-main">
          <h3>${escapeHtml(recipe.title)}</h3>
          ${
            recipe.description
              ? `<p class="recipe-desc">${escapeHtml(recipe.description)}</p>`
              : ""
          }
          <div class="recipe-meta">
            ${recipeTags}
          </div>
        </div>
        <div class="recipe-secondary">
          <div>
            <strong>Ingredients</strong>
            <pre>${escapeHtml(recipe.ingredients || "")}</pre>
          </div>
          <div>
            <strong>Steps</strong>
            <pre>${escapeHtml(recipe.steps || "")}</pre>
          </div>
        </div>
        <div class="recipe-actions">
          <button class="btn subtle" data-action="edit">Edit</button>
          <button class="btn danger" data-action="delete">Delete</button>
        </div>
      `;

    return listItem;
  };

  const render = () => {
    if (!listEl || !emptyStateEl) return;

    const filteredRecipes = getFilteredRecipes();

    listEl.innerHTML = "";

    if (!filteredRecipes.length) {
      emptyStateEl.classList.remove("hidden");
      return;
    }
    emptyStateEl.classList.add("hidden");

    for (const recipe of filteredRecipes) {
      const listItem = createRecipeListItem(recipe);
      listEl.appendChild(listItem);
    }
  };

  const loadRecipes = async () => {
    if (!listEl || !emptyStateEl) return;
    try {
      const res = await fetch("/api/recipes");
      if (!res.ok) throw new Error("Failed to load recipes");
      recipes = await res.json();
      render();
    } catch (err) {
      console.error(err);
      showToast("Could not load recipes.");
    }
  };

  const fetchRandomMealFromApi = async () => {
    const res = await fetch(
      "https://www.themealdb.com/api/json/v1/1/random.php"
    );
    if (!res.ok) {
      throw new Error("Random recipe API failed");
    }
    const payload = await res.json();
    const mealData = payload && payload.meals && payload.meals[0];
    if (!mealData) {
      throw new Error("No recipe returned from API");
    }
    return mealData;
  };

  const buildIngredientsText = (mealData) => {
    const ingredientsLines = [];
    for (let i = 1; i <= 20; i++) {
      const ingredient = mealData[`strIngredient${i}`];
      const measure = mealData[`strMeasure${i}`];
      if (ingredient && ingredient.trim()) {
        const line = `- ${[measure, ingredient].filter(Boolean).join(" ").trim()}`;
        ingredientsLines.push(line);
      }
    }
    return ingredientsLines.join("\n");
  };

  const buildTagsAndDescription = (mealData) => {
    const tags = [];
    if (mealData.strTags) {
      tags.push(
        ...mealData.strTags
          .split(",")
          .map((tagValue) => tagValue.trim())
          .filter(Boolean)
      );
    }
    if (mealData.strCategory) tags.push(mealData.strCategory);
    if (mealData.strArea) tags.push(mealData.strArea);

    const descriptionParts = [];
    if (mealData.strCategory) descriptionParts.push(mealData.strCategory);
    if (mealData.strArea) descriptionParts.push(mealData.strArea);
    const description = descriptionParts.length
      ? `From ${descriptionParts.join(" · ")}`
      : "";

    return { tags, description };
  };

  const transformMealToRecipe = (mealData) => {
    const title = mealData.strMeal || "Random recipe";
    const ingredients = buildIngredientsText(mealData);
    const { tags, description } = buildTagsAndDescription(mealData);
    const steps = mealData.strInstructions || "";

    return {
      title,
      description,
      ingredients,
      steps,
      tags,
    };
  };

  const fetchRandomRecipeFromApi = async () => {
    const mealData = await fetchRandomMealFromApi();
    return transformMealToRecipe(mealData);
  };

  const upsertRecipe = async (payload) => {
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/recipes/${payload.id}` : "/api/recipes";
    const method = isEdit ? "PUT" : "POST";

    withLoading(true);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }
      if (isEdit) {
        recipes = recipes.map((recipeItem) =>
          recipeItem.id === data.id ? data : recipeItem
        );
        showToast("Recipe updated");
      } else {
        recipes.push(data);
        showToast("Recipe added");
      }
      render();
      if (!isEdit) {
        clearForm();
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Could not save recipe.");
    } finally {
      withLoading(false);
    }
  };

  const deleteRecipe = async (id) => {
    if (!listEl) return;
    if (!window.confirm("Delete this recipe?")) return;
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not delete");
      }
      recipes = recipes.filter((recipeItem) => recipeItem.id !== id);
      render();
      showToast("Recipe deleted");
      if (formEl && String(idEl.value) === String(id)) {
        clearForm();
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Delete failed");
    }
  };

  const clearForm = () => {
    if (!formEl) return;
    idEl.value = "";
    titleEl.value = "";
    if (descriptionEl) {
      descriptionEl.value = "";
    }
    ingredientsEl.value = "";
    stepsEl.value = "";
    tagsEl.value = "";
  };

  const fillFormForEdit = (recipe) => {
    if (!formEl) return;
    idEl.value = recipe.id;
    titleEl.value = recipe.title || "";
    if (descriptionEl) {
      descriptionEl.value = recipe.description || "";
    }
    ingredientsEl.value = recipe.ingredients || "";
    stepsEl.value = recipe.steps || "";
    tagsEl.value = (recipe.tags || []).join(", ");
    titleEl.focus();
  };

  const attachFormEvents = () => {
    if (!formEl) return;

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = {
        id: idEl.value ? Number(idEl.value) : undefined,
        title: titleEl.value.trim(),
        description: descriptionEl ? descriptionEl.value : "",
        ingredients: ingredientsEl.value,
        steps: stepsEl.value,
        tags: tagsEl.value
          .split(",")
          .map((tagValue) => tagValue.trim())
          .filter(Boolean),
      };
      if (!payload.title) {
        showToast("Title is required");
        titleEl.focus();
        return;
      }
      upsertRecipe(payload);
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        clearForm();
      });
    }
  };

  const attachListEvents = () => {
    if (!listEl) return;

    if (searchEl) {
      searchEl.addEventListener("input", (event) => {
        filter = event.target.value;
        render();
      });
    }

    listEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      const card = event.target.closest(".recipe-card");
      if (!card) return;
      const id = Number(card.dataset.id);
      const recipe = recipes.find((recipeItem) => recipeItem.id === id);
      if (!recipe) return;

      if (button) {
        const action = button.dataset.action;
        if (action === "edit") {
          if (formEl) {
            fillFormForEdit(recipe);
          } else {
            window.location.href = `/?edit_id=${encodeURIComponent(id)}`;
          }
        } else if (action === "delete") {
          deleteRecipe(id);
        }
        event.stopPropagation();
      } else if (formEl) {
        fillFormForEdit(recipe);
      }
    });
  };

  const attachThemeEvents = () => {
    if (!themeBtn) return;
    themeBtn.addEventListener("click", () => {
      toggleTheme();
    });
  };

  const loadRecipeForInitialEdit = async () => {
    if (!formEl) return;
    const params = new URLSearchParams(window.location.search);
    const editIdParam = params.get("edit_id");
    if (!editIdParam) return;

    const recipeId = Number(editIdParam);
    if (!Number.isFinite(recipeId) || recipeId <= 0) return;

    try {
      const res = await fetch(`/api/recipes/${recipeId}`);
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Could not load recipe to edit.");
        return;
      }
      fillFormForEdit(data);
    } catch (err) {
      console.error(err);
      showToast("Could not load recipe to edit.");
    }
  };

  if (randomBtn) {
    randomBtn.addEventListener("click", async () => {
      randomBtn.disabled = true;
      randomBtn.textContent = "Loading…";
      try {
        showToast("Fetching a random recipe…");
        const randomRecipe = await fetchRandomRecipeFromApi();
        await upsertRecipe(randomRecipe);
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not fetch random recipe.");
      } finally {
        randomBtn.disabled = false;
        randomBtn.textContent = "Random recipe";
      }
    });
  }

  initTheme();
  attachThemeEvents();
  attachFormEvents();
  attachListEvents();
  loadRecipes();
  loadRecipeForInitialEdit();
})();

