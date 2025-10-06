// App.js
import * as SplashScreen from "expo-splash-screen";
import { Asset } from "expo-asset";
SplashScreen.preventAutoHideAsync();
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  StyleSheet,
  StatusBar,
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as ImagePicker from "expo-image-picker";
import * as IntentLauncher from "expo-intent-launcher";

import { doRegister, doLogin } from "./src/auth";
import { getProfile, clearToken, saveProfile } from "./src/storage";
import API from "./src/api";
import { API_BASE } from "./src/constants";

const { width } = Dimensions.get("window");

const LOCATION_TASK = "dse-tracking-task";
const TRACK_KEY = "dse_tracking_enabled";

let OUTBOX = [];

// -------- background task (always send locations) ----------
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Location task error:", error);
    return;
  }
  try {
    if (data?.locations?.length) {
      OUTBOX.push(...data.locations);
      if (OUTBOX.length >= 3) await flushOutbox();
    }
  } catch (e) {
    console.error("BG task error:", e?.message || e);
  }
});

async function flushOutbox() {
  if (!OUTBOX.length) return;

  let token = null;
  try {
    token = await SecureStore.getItemAsync("auth_token");
  } catch {}
  if (!token) {
    const profStr = await AsyncStorage.getItem("profile");
    if (profStr) {
      const prof = JSON.parse(profStr);
      token = prof?.token || null;
    }
  }

  if (!token) {
    console.warn("⚠️ No auth token found; skipping upload");
    return;
  }

  const pts = OUTBOX.map((loc) => ({
    ts: loc.timestamp,
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    acc: loc.coords.accuracy,
    speed: loc.coords.speed,
    heading: loc.coords.heading,
    provider: loc.provider,
  }));

  try {
    await API.post("/tracking/locations", { points: pts });
    OUTBOX = [];
  } catch (err) {
    console.error("Upload failed:", err?.response?.data || err?.message || err);
  }
}

// ======================= MAIN APP =======================
export default function App() {
  // auth + profile
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [photoUri, setPhotoUri] = useState("");
  const [clientMobile, setClientMobile] = useState("");
  const [clientCurrentAddress, setClientCurrentAddress] = useState("");
  const [clientPermanentAddress, setClientPermanentAddress] = useState("");
  const [useSameAddress, setUseSameAddress] = useState(false);
  const [visitLocation, setVisitLocation] = useState(null);

  // work/tracking
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  // pages/tabs
  const [tab, setTab] = useState("work"); // 'work' | 'visits'

  // visit modal state
  const [visitVisible, setVisitVisible] = useState(false);
  const [clientName, setClientName] = useState("");
  const [visitPhotoUri, setVisitPhotoUri] = useState("");
  const [visitLoading, setVisitLoading] = useState(false);

  // toast
  const [appToast, setAppToast] = useState("");
  const appToastTimer = useRef(null);

  // animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ------------------- effects -------------------
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    (async () => {
      try {
        await Asset.fromModule(require("./assets/icon.png")).downloadAsync();

        const prof = await getProfile();
        if (prof?.user) setUser(prof.user);
        else if (prof) setUser(prof);

        const flag = await AsyncStorage.getItem(TRACK_KEY);
        if (flag === "1") {
          try {
            const started = await Location.hasStartedLocationUpdatesAsync(
              LOCATION_TASK
            );
            if (!started) await startBackgroundUpdates();
            setTracking(true);
            setStatus("Sharing location…");
          } catch (e) {
            console.warn("Auto-resume failed:", e?.message || e);
          }
        }
      } finally {
        SplashScreen.hideAsync();
      }
    })();

    return () => {
      if (appToastTimer.current) clearTimeout(appToastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (tracking) {
      const pulse = () => {
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]).start(() => pulse());
      };
      pulse();
    }
  }, [tracking]);

  // ------------------- helpers -------------------
  const showToast = (msg) => {
    setAppToast(msg);
    if (appToastTimer.current) clearTimeout(appToastTimer.current);
    appToastTimer.current = setTimeout(() => setAppToast(""), 2200);
  };

  const getInitials = (fullName = "") =>
    fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || "")
      .join("") || "D";

  // ------------------- auth -------------------
  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow gallery access to pick a photo.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!res.canceled && res.assets?.length) setPhotoUri(res.assets[0].uri);
  };

  const doAuth = async () => {
    if (
      !phone.trim() ||
      !password.trim() ||
      (authMode === "register" && !name.trim())
    ) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      let u = null;
      if (authMode === "register") {
        u = await doRegister({ name, phone, password, photoUri });
        if (!u) throw new Error("No user returned from register");
      } else {
        u = await doLogin({ phone, password });
        if (!u) throw new Error("No user returned from login");
      }
      setUser(u);
      setAvatarBroken(false);
      showToast(
        authMode === "register" ? "Registered successfully" : "Login successful"
      );
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Authentication failed";
      Alert.alert("Auth failed", msg);
    } finally {
      setLoading(false);
    }
  };

  // ------------------- tracking background -------------------
  const startBackgroundUpdates = async () => {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) throw new Error("Please enable Location services (GPS).");

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted")
      throw new Error("Foreground permission denied.");

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted")
      throw new Error("Background permission denied.");

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10000,
      distanceInterval: 10,
      foregroundService: {
        notificationTitle: "DSE Tracking",
        notificationBody: "Your location is being tracked",
      },
      showsBackgroundLocationIndicator: true,
    });
  };

  const startTracking = async () => {
    setLoading(true);
    try {
      const services = await Location.hasServicesEnabledAsync();
      if (!services) throw new Error("Please enable Location services (GPS).");

      // Foreground permission
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== "granted")
        throw new Error("Foreground permission not granted");

      // Background permission (needed for Android 10+)
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== "granted")
        throw new Error("Background permission not granted");

      // Start background tracking task
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000, // every 10 seconds
        distanceInterval: 10, // or every 10 meters
        foregroundService: {
          notificationTitle: "DSE Tracking",
          notificationBody: "Your location is being tracked",
        },
        showsBackgroundLocationIndicator: true,
      });

      // Save flag so auto-resume works
      await AsyncStorage.setItem(TRACK_KEY, "1");

      setTracking(true);
      setStatus("Sharing location…");
      showToast("Tracking started ✅");
    } catch (error) {
      console.error("Tracking error:", error);
      Alert.alert("Error", error?.message || "Failed to start tracking");
    } finally {
      setLoading(false);
    }
  };

  const stopTracking = async () => {
    setLoading(true);
    try {
      const isOn = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (isOn) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      await AsyncStorage.removeItem(TRACK_KEY);

      // 🚀 Mark instantly offline on backend
      try {
        await API.post("/tracking/offline", { userId: user?.id });
      } catch (e) {
        console.warn("Failed to mark offline:", e?.message);
      }

      setTracking(false);
      setStatus("Idle");
      showToast("Tracking stopped");
    } catch (error) {
      Alert.alert("Error", "Failed to stop tracking");
    } finally {
      setLoading(false);
    }
  };

  // ------------------- visit modal -------------------
  const openVisitPopup = () => setVisitVisible(true);
  const closeVisitPopup = () => {
    setVisitVisible(false);
    setClientName("");
    setVisitPhotoUri("");
  };

  const takeVisitPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Camera access is required to take a live photo."
      );
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.7,
    });
    if (!res.canceled && res.assets?.length)
      setVisitPhotoUri(res.assets[0].uri);
  };

  const submitVisit = async () => {
    if (!clientName.trim()) return Alert.alert("Missing", "Enter client name");
    if (!clientMobile.trim())
      return Alert.alert("Missing", "Enter client mobile");
    if (!clientCurrentAddress.trim())
      return Alert.alert("Missing", "Enter current address");
    if (!useSameAddress && !clientPermanentAddress.trim())
      return Alert.alert("Missing", "Enter permanent address");
    if (!visitPhotoUri) return Alert.alert("Missing", "Capture live photo");
    if (!visitLocation)
      return Alert.alert("Missing", "Please upload current location first");

    setVisitLoading(true);
    try {
      const {
        latitude: lat,
        longitude: lon,
        accuracy: acc,
      } = visitLocation || {};
      const form = new FormData();
      form.append("clientName", clientName.trim());
      form.append("clientMobile", clientMobile.trim());
      form.append("currentAddress", clientCurrentAddress.trim());
      form.append(
        "permanentAddress",
        useSameAddress
          ? clientCurrentAddress.trim()
          : clientPermanentAddress.trim()
      );
      form.append("lat", String(lat));
      form.append("lon", String(lon));
      if (acc != null) form.append("acc", String(acc));
      if (user?.id) form.append("dseId", String(user.id));
      if (user?.name) form.append("dseName", String(user.name));
      if (user?.phone) form.append("dsePhone", String(user.phone));

      const filename = visitPhotoUri.split("/").pop() || "visit.jpg";
      const ext = (filename.split(".").pop() || "jpg").toLowerCase();
      const type =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      form.append("photo", { uri: visitPhotoUri, name: filename, type });

      await API.post("/auth/dse/visit", form, {
        headers: { "Content-Type": "multipart/form-data" },
        transformRequest: (d) => d,
      });

      closeVisitPopup();
      showToast("✅ Client visit submitted");
    } catch (e) {
      Alert.alert("Error", e?.response?.data?.message || e?.message);
    } finally {
      setVisitLoading(false);
    }
  };

  // ------------------- misc -------------------
  const testPing = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/tracking/ping`);
      const j = await r.json();
      showToast("Ping OK");
      console.log("Ping:", j);
    } catch (e) {
      Alert.alert("Ping failed", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await clearToken();
    await saveProfile(null);
    setUser(null);
    showToast("Logged out");
  };

  useEffect(() => {
    const interval = setInterval(() => {
      flushOutbox();
    }, 60000); // every 1 minute
    return () => clearInterval(interval);
  }, []);
  // ------------------- AUTH SCREEN -------------------
  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0D1117" />
        {!!appToast && <ToastBanner text={appToast} />}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Animated.View
            style={[
              styles.authContainer,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View style={styles.brandWrap}>
              <Image
                source={require("./assets/icon.png")}
                style={styles.brandLogo}
                resizeMode="contain"
              />
              <Text style={styles.brandTitle}>DSE Tracker</Text>
              <Text style={styles.brandSubtitle}>Field Tracking System</Text>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.cardTitle}>
                {authMode === "register" ? "Create Account" : "Welcome Back"}
              </Text>

              {authMode === "register" && (
                <>
                  <TextInput
                    placeholder="Full Name"
                    placeholderTextColor="#8B949E"
                    value={name}
                    onChangeText={setName}
                    style={styles.input}
                  />
                  <TouchableOpacity
                    style={styles.pickButton}
                    onPress={pickPhoto}
                    disabled={loading}
                  >
                    <Text style={styles.pickButtonText}>
                      {photoUri ? "Change Photo" : "Upload DSE Photo"}
                    </Text>
                  </TouchableOpacity>
                  {!!photoUri && (
                    <View style={styles.previewWrap}>
                      <Image
                        source={{ uri: photoUri }}
                        style={styles.preview}
                        resizeMode="cover"
                      />
                      <Text style={styles.previewHint}>Photo selected</Text>
                    </View>
                  )}
                </>
              )}

              <TextInput
                placeholder="Phone Number"
                placeholderTextColor="#8B949E"
                value={phone}
                onChangeText={setPhone}
                style={styles.input}
                keyboardType="phone-pad"
              />

              <TextInput
                placeholder="Password"
                placeholderTextColor="#8B949E"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.disabledButton]}
                onPress={doAuth}
                disabled={loading}
              >
                <Text style={styles.primaryButtonText}>
                  {loading
                    ? "Please wait..."
                    : authMode === "register"
                    ? "Create Account"
                    : "Sign In"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() =>
                  setAuthMode(authMode === "register" ? "login" : "register")
                }
              >
                <Text style={styles.secondaryButtonText}>
                  {authMode === "register"
                    ? "Already have an account? Sign In"
                    : "New user? Create Account"}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // ------------------- MAIN (TWO PAGES) -------------------
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D1117" />
      {!!appToast && <ToastBanner text={appToast} />}
      <Animated.View
        style={[
          styles.mainContainer,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Header with avatar + tabs */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {user?.photoUrl && !avatarBroken ? (
              <Image
                source={{ uri: user.photoUrl }}
                style={styles.avatar}
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {getInitials(user?.name)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.userName}>{user?.name}</Text>
              <Text style={styles.userPhone}>{user?.phone}</Text>
            </View>
          </View>

          <View style={styles.tabsWrap}>
            <Pressable
              onPress={() => setTab("work")}
              style={[styles.tabBtn, tab === "work" && styles.tabBtnActive]}
            >
              <Text
                style={[styles.tabText, tab === "work" && styles.tabTextActive]}
              >
                Work
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab("visits")}
              style={[styles.tabBtn, tab === "visits" && styles.tabBtnActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === "visits" && styles.tabTextActive,
                ]}
              >
                Visits
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* PAGE: WORK */}
          {tab === "work" && (
            <>
              <View style={styles.card}>
                <View style={styles.statusHeader}>
                  <Text style={styles.statusLabel}>Current Status</Text>
                  <Animated.View
                    style={[
                      styles.statusIndicator,
                      {
                        backgroundColor: tracking ? "#00D924" : "#8B949E",
                        transform: tracking
                          ? [{ scale: pulseAnim }]
                          : [{ scale: 1 }],
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.statusText,
                    { color: tracking ? "#00D924" : "#8B949E" },
                  ]}
                >
                  {status}
                </Text>
              </View>

              <View style={styles.actionContainer}>
                <TouchableOpacity
                  style={[
                    styles.trackingButton,
                    tracking ? styles.stopButton : styles.startButton,
                    loading && styles.disabledButton,
                  ]}
                  onPress={tracking ? stopTracking : startTracking}
                  disabled={loading}
                >
                  <Text style={styles.trackingButtonText}>
                    {loading
                      ? "Processing..."
                      : tracking
                      ? "🛑 Stop Working"
                      : "▶️ Start Working"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.testButton,
                    (!tracking || loading) && styles.disabledButton,
                  ]}
                  onPress={openVisitPopup}
                  disabled={loading || !tracking}
                >
                  <Text style={styles.testButtonText}>
                    {tracking
                      ? "📍 Arrived at client (open form)"
                      : "Start Working to report a visit"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testButton, loading && styles.disabledButton]}
                  onPress={testPing}
                  disabled={loading}
                >
                  <Text style={styles.testButtonText}>📡 Test Connection</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.logoutButton,
                    loading && styles.disabledButton,
                  ]}
                  onPress={logout}
                  disabled={loading}
                >
                  <Text style={styles.logoutButtonText}>🚪 Logout</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* PAGE: VISITS */}
          {tab === "visits" && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Client Visits</Text>
              <Text style={{ color: "#8B949E", marginBottom: 12 }}>
                Log a new client visit from here as well.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={openVisitPopup}
              >
                <Text style={styles.primaryButtonText}>+ New Visit</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* VISIT MODAL */}
        <Modal visible={visitVisible} transparent animationType="fade">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>Client Visit</Text>

                {/* ---- Client Basic ---- */}
                <TextInput
                  placeholder="Client Name (required)"
                  placeholderTextColor="#8B949E"
                  value={clientName}
                  onChangeText={setClientName}
                  style={styles.input}
                />

                <TextInput
                  placeholder="Client Mobile Number"
                  placeholderTextColor="#8B949E"
                  keyboardType="phone-pad"
                  value={clientMobile}
                  onChangeText={setClientMobile}
                  style={styles.input}
                />

                {/* ---- Address Fields ---- */}
                <TextInput
                  placeholder="Current Address"
                  placeholderTextColor="#8B949E"
                  value={clientCurrentAddress}
                  onChangeText={setClientCurrentAddress}
                  style={styles.input}
                  multiline
                />

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => {
                      setUseSameAddress(!useSameAddress);
                      if (!useSameAddress)
                        setClientPermanentAddress(clientCurrentAddress);
                    }}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: "#58A6FF",
                      backgroundColor: useSameAddress
                        ? "#58A6FF"
                        : "transparent",
                      marginRight: 8,
                    }}
                  />
                  <Text style={{ color: "#F0F6FC", fontSize: 14 }}>
                    Same as Current Address
                  </Text>
                </View>

                {!useSameAddress && (
                  <TextInput
                    placeholder="Permanent Address"
                    placeholderTextColor="#8B949E"
                    value={clientPermanentAddress}
                    onChangeText={setClientPermanentAddress}
                    style={styles.input}
                    multiline
                  />
                )}

                {/* ---- Capture Location ---- */}
                <TouchableOpacity
                  style={[styles.cameraButton, { backgroundColor: "#30363D" }]}
                  onPress={async () => {
                    try {
                      const fg =
                        await Location.requestForegroundPermissionsAsync();
                      if (fg.status !== "granted")
                        throw new Error("Permission denied");
                      const pos = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High,
                      });
                      setVisitLocation(pos.coords);
                      showToast("✅ Location captured");
                    } catch (e) {
                      Alert.alert("Location Error", e.message);
                    }
                  }}
                >
                  <Text style={styles.cameraButtonText}>
                    📍 Upload Current Location
                  </Text>
                </TouchableOpacity>

                {!!visitLocation?.latitude && (
                  <Text
                    style={{
                      color: "#58A6FF",
                      fontSize: 13,
                      textAlign: "center",
                      marginBottom: 8,
                    }}
                  >
                    Lat: {visitLocation.latitude.toFixed(5)}, Lon:{" "}
                    {visitLocation.longitude.toFixed(5)}
                  </Text>
                )}

                {/* ---- Photo ---- */}
                <TouchableOpacity
                  style={styles.cameraButton}
                  onPress={takeVisitPhoto}
                  disabled={visitLoading}
                >
                  <Text style={styles.cameraButtonText}>
                    {visitPhotoUri
                      ? "📷 Retake Live Photo"
                      : "📷 Take Live Photo"}
                  </Text>
                </TouchableOpacity>

                {!!visitPhotoUri && (
                  <View style={styles.photoPreviewWrap}>
                    <Image
                      source={{ uri: visitPhotoUri }}
                      style={styles.photoPreview}
                      resizeMode="cover"
                    />
                    <Text style={styles.photoPreviewText}>
                      Live photo ready
                    </Text>
                  </View>
                )}

                <Text style={styles.infoText}>
                  Ensure all fields are filled correctly before submission.
                </Text>

                {/* ---- Buttons ---- */}
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[
                      styles.submitButton,
                      (!clientName.trim() ||
                        !visitPhotoUri ||
                        !visitLocation ||
                        visitLoading) &&
                        styles.disabledButton,
                    ]}
                    onPress={submitVisit}
                    disabled={
                      !clientName.trim() ||
                      !visitPhotoUri ||
                      !visitLocation ||
                      visitLoading
                    }
                  >
                    <Text style={styles.submitButtonText}>
                      {visitLoading ? "Submitting…" : "Submit"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.cancelButton,
                      visitLoading && styles.disabledButton,
                    ]}
                    onPress={closeVisitPopup}
                    disabled={visitLoading}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Animated.View>
    </View>
  );
}

// ---------- Inline Toast Banner ----------
const ToastBanner = ({ text }) => (
  <View style={styles.toastWrap}>
    <Text style={styles.toastText}>{text}</Text>
  </View>
);

// ---------- styles ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D1117" },
  scrollContent: { flexGrow: 1, paddingBottom: 20 },
  authContainer: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  mainContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },

  // BRAND
  brandWrap: { alignItems: "center", marginBottom: 24 },
  brandLogo: { width: 96, height: 96, marginBottom: 8 },
  brandTitle: {
    fontSize: 22,
    color: "#F0F6FC",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  brandSubtitle: { color: "#8B949E", marginTop: 2 },

  // toast
  toastWrap: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    backgroundColor: "#161B22",
    borderColor: "#2ea043",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    zIndex: 999,
    elevation: 5,
  },
  toastText: { color: "#d2ffd8", fontSize: 14, fontWeight: "600" },

  // header
  header: { marginBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#30363D",
    marginRight: 16,
    backgroundColor: "#161B22",
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#30363D",
    marginRight: 16,
    backgroundColor: "#161B22",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { color: "#F0F6FC", fontSize: 18, fontWeight: "700" },
  welcomeText: { fontSize: 14, color: "#8B949E" },
  userName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#F0F6FC",
    marginTop: 2,
  },
  userPhone: { fontSize: 14, color: "#58A6FF", marginTop: 2 },

  // tabs
  tabsWrap: {
    flexDirection: "row",
    backgroundColor: "#161B22",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#30363D",
    overflow: "hidden",
    marginTop: 12,
  },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabBtnActive: { backgroundColor: "#1F2630" },
  tabText: { color: "#8B949E", fontSize: 14 },
  tabTextActive: { color: "#F0F6FC", fontWeight: "600" },

  // cards
  formCard: {
    backgroundColor: "#161B22",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  card: {
    backgroundColor: "#161B22",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#30363D",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    color: "#F0F6FC",
    fontWeight: "600",
    marginBottom: 12,
  },

  input: {
    backgroundColor: "#21262D",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#F0F6FC",
    borderWidth: 1,
    borderColor: "#30363D",
    marginBottom: 16,
  },

  primaryButton: {
    backgroundColor: "#238636",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },

  secondaryButton: { alignItems: "center", paddingVertical: 12 },
  secondaryButtonText: { color: "#58A6FF", fontSize: 14 },

  pickButton: {
    backgroundColor: "#30363D",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3A3F47",
    marginBottom: 16,
  },
  pickButtonText: { color: "#F0F6FC", fontSize: 14 },
  previewWrap: { alignItems: "center", marginBottom: 16 },
  preview: {
    width: 120,
    height: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  previewHint: { color: "#8B949E", fontSize: 12, marginTop: 6 },

  statusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusLabel: {
    fontSize: 12,
    color: "#8B949E",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  statusIndicator: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 22, fontWeight: "600", marginTop: 6 },

  actionContainer: { gap: 12, marginTop: 4 },
  trackingButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  startButton: { backgroundColor: "#238636" },
  stopButton: { backgroundColor: "#DA3633" },
  trackingButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  testButton: {
    backgroundColor: "#21262D",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#30363D",
  },
  testButtonText: { color: "#58A6FF", fontSize: 15, fontWeight: "500" },
  logoutButton: {
    backgroundColor: "#444C56",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  logoutButtonText: { color: "#F85149", fontSize: 16, fontWeight: "600" },
  disabledButton: { opacity: 0.5 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center", // 👈 center vertically
    alignItems: "center", // 👈 center horizontally
  },

  modalCard: {
    backgroundColor: "#161B22",
    borderRadius: 20, // 👈 same border for all corners
    padding: 24,
    borderWidth: 1,
    borderColor: "#30363D",
    width: "90%", // 👈 make width responsive
    maxHeight: "80%", // 👈 keep it scrollable on small screens
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F0F6FC",
    marginBottom: 20,
    textAlign: "center",
  },

  cameraButton: {
    backgroundColor: "#1F6FEB",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  cameraButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },

  photoPreviewWrap: {
    alignItems: "center",
    marginBottom: 16,
    backgroundColor: "#0D1117",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  photoPreview: {
    width: 200,
    height: 200,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#238636",
  },
  photoPreviewText: {
    color: "#2ea043",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
  },

  infoText: {
    color: "#8B949E",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
    textAlign: "center",
  },

  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },

  submitButton: {
    flex: 1,
    backgroundColor: "#238636",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },

  cancelButton: {
    flex: 1,
    backgroundColor: "#30363D",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#F0F6FC",
    fontSize: 16,
    fontWeight: "600",
  },
});
