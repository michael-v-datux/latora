/**
 * apiClient.js — Axios клієнт з автоматичним Bearer токеном (Supabase Auth)
 *
 * Сервер очікує:
 *   Authorization: Bearer <access_token>
 */

import axios from "axios";
import { API_BASE_URL } from "../utils/constants";
import { supabase } from "../config/supabase";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // Якщо сесії нема — просто відправляємо без токена (публічні ендпоїнти)
  }
  return config;
});
