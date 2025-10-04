// src/api.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { API_BASE } from "./constants";

const API = axios.create({
  baseURL: API_BASE + "/api",
});

API.interceptors.request.use(async (config) => {
  let token = null;

  // 🟡 Try SecureStore first
  try {
    token = await SecureStore.getItemAsync("auth_token");
  } catch {}

  // 🟡 If not found, try from AsyncStorage profile
  if (!token) {
    const profileStr = await AsyncStorage.getItem("profile");
    if (profileStr) {
      const profile = JSON.parse(profileStr);
      token = profile?.token || null;
    }
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default API;
