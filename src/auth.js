// src/auth.js
import API from "./api";
import { saveProfile } from "./storage";

// Robust JSON parser for {user,token} whether it's nested or top-level
const parseUserToken = (data) => {
  const payload = data?.data || data; // handle ok() wrappers
  const user = payload?.user || payload?.data?.user || null;
  const token = payload?.token || payload?.data?.token || null;
  return { user, token };
};

export const doRegister = async ({ name, phone, password, photoUri }) => {
  const form = new FormData();
  form.append("name", name);
  form.append("phone", phone);
  form.append("password", password);

  if (photoUri) {
    const filename = photoUri.split("/").pop() || "dse.jpg";
    const ext = filename.split(".").pop().toLowerCase();
    const type =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;

    form.append("photo", { uri: photoUri, name: filename, type });
  }

  // ✅ Use the DSE endpoint
  const { data } = await API.post("/auth/register-dse", form, {
    headers: { "Content-Type": "multipart/form-data" },
    transformRequest: (d) => d, // keep FormData intact in RN
  });

  const { user, token } = parseUserToken(data);
  if (user && token) await saveProfile({ user, token });
  return user;
};

export const doLogin = async ({ phone, password }) => {
  // ✅ Use the DSE login endpoint
  const { data } = await API.post("/auth/login-dse", { phone, password });
  const { user, token } = parseUserToken(data);
  if (user && token) await saveProfile({ user, token });
  return user;
};
