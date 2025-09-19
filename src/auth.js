// src/auth.js
import API from "./api";
import { saveToken, saveProfile } from "./storage";

function pickUser(payload) {
  // Normalize various shapes: {user}, {data:{user}}, or whole object
  if (!payload) return null;
  if (payload.user) return payload.user;
  if (payload.data?.user) return payload.data.user;
  // sometimes backend returns the user fields at top-level
  if (payload.id && payload.phone) return payload;
  return null;
}

export async function doRegister({ name, phone, password }) {
  const { data } = await API.post("/auth/register-dse", {
    name,
    phone,
    password,
  });
  const token = data?.token || data?.data?.token || null;
  const user = pickUser(data);
  if (!token || !user) {
    throw new Error("Invalid register response from server");
  }
  await saveToken(token);
  await saveProfile(user);
  return user;
}

export async function doLogin({ phone, password }) {
  const { data } = await API.post("/auth/login-dse", { phone, password });
  const token = data?.token || data?.data?.token || null;
  const user = pickUser(data);
  if (!token || !user) {
    throw new Error("Invalid login response from server");
  }
  await saveToken(token);
  await saveProfile(user);
  return user;
}
