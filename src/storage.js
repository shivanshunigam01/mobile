import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "auth_token";
const PROFILE_KEY = "profile";

export async function saveToken(t) {
  if (!t) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  if (typeof t !== "string") t = String(t);
  await SecureStore.setItemAsync(TOKEN_KEY, t);
}

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveProfile(profile) {
  if (!profile) {
    await AsyncStorage.removeItem(PROFILE_KEY);
    return;
  }
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function getProfile() {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
