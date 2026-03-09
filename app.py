from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "recipes.json"
DB_FILE = BASE_DIR / "recipes.db"


def _normalize_tags(raw_tags: Any) -> List[str]:
    """Convert tags from string or list into a clean list of strings."""
    if raw_tags is None:
        return []
    if isinstance(raw_tags, list):
        return [str(tag).strip() for tag in raw_tags if str(tag).strip()]
    if isinstance(raw_tags, str):
        return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
    return []


def _tags_list_to_text(tags: List[str]) -> str:
    """Convert list of tags into a single comma-separated string."""
    return ", ".join(_normalize_tags(tags))


def _tags_text_to_list(tags_text: str | None) -> List[str]:
    """Convert stored comma-separated tags text into a list of strings."""
    if not tags_text:
        return []
    return [tag.strip() for tag in tags_text.split(",") if tag.strip()]


def _get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def _initialize_database() -> None:
    connection = _get_connection()
    try:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS recipes (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    ingredients TEXT NOT NULL,
                    steps TEXT NOT NULL,
                    tags TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL
                )
                """
            )
    finally:
        connection.close()


def _load_recipes_from_json() -> List[Dict[str, Any]]:
    """Read recipes from the legacy JSON file, if it exists."""
    if not DATA_FILE.exists():
        return []
    try:
        with DATA_FILE.open("r", encoding="utf-8") as file_obj:
            data = json.load(file_obj)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _migrate_json_to_sqlite() -> None:
    """One-time migration from recipes.json into SQLite, if database is empty."""
    connection = _get_connection()
    try:
        cursor = connection.execute("SELECT COUNT(*) AS count FROM recipes")
        row = cursor.fetchone()
        if row and row["count"]:
            return

        legacy_recipes = _load_recipes_from_json()
        if not legacy_recipes:
            return

        with connection:
            for legacy in legacy_recipes:
                tags_text = _tags_list_to_text(
                    _normalize_tags(legacy.get("tags") or [])
                )
                connection.execute(
                    """
                    INSERT INTO recipes (id, title, description, ingredients, steps, tags)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        legacy.get("id"),
                        (legacy.get("title") or "").strip(),
                        (legacy.get("description") or "").strip(),
                        (legacy.get("ingredients") or "").strip(),
                        (legacy.get("steps") or "").strip(),
                        tags_text,
                    ),
                )
    finally:
        connection.close()


def _row_to_recipe(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a SQLite row into the JSON recipe structure expected by the UI."""
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "ingredients": row["ingredients"],
        "steps": row["steps"],
        "tags": _tags_text_to_list(row["tags"]),
    }


def _get_user_from_session() -> Optional[Dict[str, Any]]:
    """Return the current logged-in user dict from the database, or None."""
    user_id = session.get("user_id")
    if not user_id:
        return None

    try:
        connection = _get_connection()
        cursor = connection.execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        )
        row = cursor.fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()

    if not row:
        return None
    return {"id": row["id"], "username": row["username"]}


def create_app() -> Flask:
    _initialize_database()
    _migrate_json_to_sqlite()

    app = Flask(__name__)
    # Simple secret key for sessions; in production load from environment.
    app.secret_key = "dev-secret-change-me"

    @app.route("/")
    def index():
        user = _get_user_from_session()
        return render_template("index.html", user=user)

    @app.route("/saved")
    def saved():
        user = _get_user_from_session()
        return render_template("saved.html", user=user)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        error: Optional[str] = None

        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            password = (request.form.get("password") or "").strip()

            if not username or not password:
                error = "Username and password are required."
            elif len(password) < 4:
                error = "Password should be at least 4 characters long."
            else:
                try:
                    connection = _get_connection()
                    with connection:
                        connection.execute(
                            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                            (username, generate_password_hash(password)),
                        )
                    # Auto-log in the new user
                    cursor = connection.execute(
                        "SELECT id FROM users WHERE username = ?", (username,)
                    )
                    row = cursor.fetchone()
                    if row:
                        session["user_id"] = row["id"]
                        return redirect(url_for("index"))
                except sqlite3.IntegrityError:
                    error = "This username is already taken. Please choose another one."
                except sqlite3.Error:
                    error = "Could not create your account. Please try again."
                finally:
                    connection.close()

        user = _get_user_from_session()
        return render_template("register.html", user=user, error=error)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        error: Optional[str] = None

        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            password = (request.form.get("password") or "").strip()

            try:
                connection = _get_connection()
                cursor = connection.execute(
                    "SELECT id, username, password_hash FROM users WHERE username = ?",
                    (username,),
                )
                row = cursor.fetchone()
            except sqlite3.Error:
                row = None
                error = "Could not log you in right now. Please try again."
            finally:
                connection.close()

            if row and check_password_hash(row["password_hash"], password):
                session["user_id"] = row["id"]
                return redirect(url_for("index"))
            elif not error:
                error = "Invalid username or password."

        user = _get_user_from_session()
        return render_template("login.html", user=user, error=error)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/api/recipes/<int:recipe_id>")
    def get_recipe(recipe_id: int):
        try:
            connection = _get_connection()
            cursor = connection.execute(
                "SELECT id, title, description, ingredients, steps, tags FROM recipes WHERE id = ?",
                (recipe_id,),
            )
            row = cursor.fetchone()
        except sqlite3.Error:
            return (
                jsonify(
                    {
                        "error": "Could not load this recipe right now. Please try again."
                    }
                ),
                500,
            )
        finally:
            connection.close()

        if not row:
            return jsonify({"error": "Recipe not found"}), 404

        return jsonify(_row_to_recipe(row))

    @app.get("/api/recipes")
    def get_recipes():
        if "user_id" not in session:
            return jsonify({"error": "Please log in to see recipes."}), 401
        try:
            connection = _get_connection()
            cursor = connection.execute(
                "SELECT id, title, description, ingredients, steps, tags FROM recipes ORDER BY id ASC"
            )
            rows = cursor.fetchall()
        except sqlite3.Error:
            return (
                jsonify(
                    {
                        "error": "Could not load recipes from the database. Please try again."
                    }
                ),
                500,
            )
        finally:
            connection.close()

        recipes = [_row_to_recipe(row) for row in rows]
        return jsonify(recipes)

    @app.post("/api/recipes")
    def add_recipe():
        if "user_id" not in session:
            return jsonify({"error": "Please log in to add recipes."}), 401
        payload = request.get_json(force=True, silent=True) or {}
        title = (payload.get("title") or "").strip()
        description = (payload.get("description") or "").strip()
        ingredients = (payload.get("ingredients") or "").strip()
        steps = (payload.get("steps") or "").strip()
        tags_list = _normalize_tags(payload.get("tags"))

        if not title:
            return (
                jsonify(
                    {"error": "Title is required so we can name your recipe."}
                ),
                400,
            )

        tags_text = _tags_list_to_text(tags_list)

        try:
            connection = _get_connection()
            with connection:
                cursor = connection.execute(
                    """
                    INSERT INTO recipes (title, description, ingredients, steps, tags)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (title, description, ingredients, steps, tags_text),
                )
                new_id = cursor.lastrowid

                cursor = connection.execute(
                    "SELECT id, title, description, ingredients, steps, tags FROM recipes WHERE id = ?",
                    (new_id,),
                )
                row = cursor.fetchone()
        except sqlite3.Error:
            return (
                jsonify(
                    {
                        "error": "Could not save your recipe to the database. Please try again."
                    }
                ),
                500,
            )
        finally:
            connection.close()

        return jsonify(_row_to_recipe(row)), 201

    @app.put("/api/recipes/<int:recipe_id>")
    def update_recipe(recipe_id: int):
        if "user_id" not in session:
            return jsonify({"error": "Please log in to edit recipes."}), 401
        payload = request.get_json(force=True, silent=True) or {}

        fields = []
        values: List[Any] = []

        if "title" in payload:
            fields.append("title = ?")
            values.append((payload.get("title") or "").strip())
        if "description" in payload:
            fields.append("description = ?")
            values.append((payload.get("description") or "").strip())
        if "ingredients" in payload:
            fields.append("ingredients = ?")
            values.append((payload.get("ingredients") or "").strip())
        if "steps" in payload:
            fields.append("steps = ?")
            values.append((payload.get("steps") or "").strip())
        if "tags" in payload:
            normalized_tags = _normalize_tags(payload.get("tags"))
            fields.append("tags = ?")
            values.append(_tags_list_to_text(normalized_tags))

        if not fields:
            # Nothing to update; just return the current recipe if it exists.
            return get_recipe(recipe_id)

        values.append(recipe_id)

        try:
            connection = _get_connection()
            with connection:
                cursor = connection.execute(
                    f"UPDATE recipes SET {', '.join(fields)} WHERE id = ?",
                    values,
                )
                if cursor.rowcount == 0:
                    return jsonify({"error": "Recipe not found"}), 404

                cursor = connection.execute(
                    "SELECT id, title, description, ingredients, steps, tags FROM recipes WHERE id = ?",
                    (recipe_id,),
                )
                row = cursor.fetchone()
        except sqlite3.Error:
            return (
                jsonify(
                    {
                        "error": "Could not update this recipe in the database. Please try again."
                    }
                ),
                500,
            )
        finally:
            connection.close()

        if not row:
            return jsonify({"error": "Recipe not found"}), 404

        return jsonify(_row_to_recipe(row))

    @app.delete("/api/recipes/<int:recipe_id>")
    def delete_recipe(recipe_id: int):
        if "user_id" not in session:
            return jsonify({"error": "Please log in to delete recipes."}), 401
        try:
            connection = _get_connection()
            with connection:
                cursor = connection.execute(
                    "DELETE FROM recipes WHERE id = ?", (recipe_id,)
                )
                if cursor.rowcount == 0:
                    return jsonify({"error": "Recipe not found"}), 404
        except sqlite3.Error:
            return (
                jsonify(
                    {
                        "error": "Could not delete this recipe from the database. Please try again."
                    }
                ),
                500,
            )
        finally:
            connection.close()

        return jsonify({"status": "deleted"})

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)


