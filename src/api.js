// src/api.js
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./constants";

const API = axios.create({
  baseURL: API_BASE + "/api", // adjust if needed
});

// automatically attach token
API.interceptors.request.use(async (config) => {
  const profileStr = await AsyncStorage.getItem("profile");
  if (profileStr) {
    const profile = JSON.parse(profileStr);
    if (profile?.token) {
      config.headers.Authorization = `Bearer ${profile.token}`;
    }
  }
  return config;
});

export default API;
