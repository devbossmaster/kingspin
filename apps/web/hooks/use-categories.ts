"use client";

import { useEffect, useState } from "react";
import { apiClient, type CategoryListItem } from "../lib/api-client";
import { toastGameError } from "../lib/error-toast";

export function useCategories() {
  const [categories, setCategories] = useState<CategoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setLoading(true);
      setError(null);

      try {
        const nextCategories = await apiClient.getCategories();

        if (!cancelled) {
          setCategories(nextCategories);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(toastGameError(caught, "Could not load categories."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  return { categories, loading, error };
}
