// App.js
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ToastAndroid,
  Platform,
  StyleSheet,
  StatusBar,
  Animated,
  Dimensions,
  Image,
} from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as ImagePicker from "expo-image-picker";
import { doRegister, doLogin } from "./src/auth";
import { getProfile, clearToken, saveProfile } from "./src/storage";
import API from "./src/api";
import { API_BASE } from "./src/constants";

const { width, height } = Dimensions.get("window");

const toast = (msg) => {
  if (Platform.OS === "android") ToastAndroid.show(msg, ToastAndroid.SHORT);
  else Alert.alert("", msg);
};

const LOCATION_TASK = "dse-tracking-task";
let OUTBOX = [];

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Location task error:", error);
    return;
  }
  if (data?.locations) {
    OUTBOX.push(...data.locations);
    if (OUTBOX.length >= 3) await flushOutbox();
  }
});

async function flushOutbox() {
  if (!OUTBOX.length) return;
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
    console.error("Upload failed:", err.message);
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [photoUri, setPhotoUri] = useState(""); // 🔹 NEW: selected image
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

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
      const prof = await getProfile();
      if (prof?.user) setUser(prof.user);
      else if (prof) setUser(prof); // backward compatibility
    })();
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
    if (!res.canceled && res.assets?.length) {
      setPhotoUri(res.assets[0].uri);
      toast("Photo selected");
    }
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
        u = await doRegister({ name, phone, password, photoUri }); // 🔹 send photo
        if (!u) throw new Error("No user returned from register");
        setUser(u);
        toast("Registered successfully");
      } else {
        u = await doLogin({ phone, password });
        if (!u) throw new Error("No user returned from login");
        setUser(u);
        toast("Login successful");
      }
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Authentication failed";
      Alert.alert("Auth failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const startTracking = async () => {
    setLoading(true);
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== "granted") {
      Alert.alert("Error", "Location permission not granted");
      setLoading(false);
      return;
    }

    try {
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
      setTracking(true);
      setStatus("Sharing location…");
      toast("Tracking started");
    } catch (error) {
      Alert.alert("Error", "Failed to start tracking");
    } finally {
      setLoading(false);
    }
  };

  const stopTracking = async () => {
    setLoading(true);
    try {
      const isOn = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (isOn) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      setTracking(false);
      setStatus("Idle");
      toast("Tracking stopped");
    } catch (error) {
      Alert.alert("Error", "Failed to stop tracking");
    } finally {
      setLoading(false);
    }
  };

  const testPing = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/tracking/ping`);
      const j = await r.json();
      toast("Ping OK");
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
    toast("Logged out");
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0D1117" />
        <Animated.View
          style={[
            styles.authContainer,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.logoContainer}>
            <Text style={styles.logo}>DSE</Text>
            <Text style={styles.logoSubtext}>Tracking System</Text>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.authTitle}>
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

                {/* 🔹 Pick image button + preview */}
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
      </View>
    );
  }

  // MAIN (after login)
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D1117" />
      <Animated.View
        style={[
          styles.mainContainer,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userPhone}>{user.phone}</Text>
        </View>

        <View style={styles.statusContainer}>
          <View style={styles.statusCard}>
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
            style={[styles.testButton, loading && styles.disabledButton]}
            onPress={testPing}
            disabled={loading}
          >
            <Text style={styles.testButtonText}>📡 Test Connection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.logoutButton, loading && styles.disabledButton]}
            onPress={logout}
            disabled={loading}
          >
            <Text style={styles.logoutButtonText}>🚪 Logout</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D1117" },
  authContainer: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  mainContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 60 },
  logoContainer: { alignItems: "center", marginBottom: 40 },
  logo: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#58A6FF",
    letterSpacing: 2,
  },
  logoSubtext: {
    fontSize: 16,
    color: "#8B949E",
    marginTop: 8,
    letterSpacing: 1,
  },
  formContainer: {
    backgroundColor: "#161B22",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#F0F6FC",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#21262D",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#F0F6FC",
    borderWidth: 1,
    borderColor: "#30363D",
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: "#238636",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  secondaryButton: { alignItems: "center", paddingVertical: 12 },
  secondaryButtonText: { color: "#58A6FF", fontSize: 14 },
  pickButton: {
    backgroundColor: "#30363D",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#3A3F47",
  },
  pickButtonText: { color: "#F0F6FC", fontSize: 14 },
  previewWrap: { alignItems: "center", marginBottom: 12 },
  preview: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  previewHint: { color: "#8B949E", fontSize: 12, marginTop: 6 },
  header: { marginBottom: 32 },
  welcomeText: { fontSize: 18, color: "#8B949E" },
  userName: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#F0F6FC",
    marginTop: 4,
  },
  userPhone: { fontSize: 16, color: "#58A6FF", marginTop: 4 },
  statusContainer: { marginBottom: 32 },
  statusCard: {
    backgroundColor: "#161B22",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  statusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: "#8B949E",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statusIndicator: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 24, fontWeight: "600" },
  actionContainer: { gap: 16 },
  trackingButton: {
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    marginBottom: 8,
  },
  startButton: { backgroundColor: "#238636" },
  stopButton: { backgroundColor: "#DA3633" },
  trackingButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  testButton: {
    backgroundColor: "#21262D",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#30363D",
  },
  testButtonText: { color: "#58A6FF", fontSize: 16, fontWeight: "500" },
  logoutButton: {
    backgroundColor: "#444C56",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  logoutButtonText: { color: "#F85149", fontSize: 16, fontWeight: "600" },
  disabledButton: { opacity: 0.6 },
});
