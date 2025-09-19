// src/api.js
import axios from "axios";
import { API_BASE } from "./constants";
import { getToken } from "./storage";

const API = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

API.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default API;
