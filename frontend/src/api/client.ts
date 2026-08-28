import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
export const AUTH_TOKEN_KEY = "outbox_auth_token";

export const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Frontend and backend are deployed on different sites, so a cookie-based
// session doesn't reliably survive browser cross-site cookie policy. Auth
// is a Bearer token instead, attached here on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
