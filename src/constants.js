export const LOCATION_TASK = "DSE_LOCATION_TRACKING_TASK";
export const API_BASE = "https://api.vikramshilaautomobiles.com/api";
// export const API_BASE = "http://192.168.29.228:5000/api"; // Local server for testing
export const DEFAULT_LOCATION_CONFIG = {
  accuracy: 3,
  timeInterval: 20000,
  distanceInterval: 25,
  showsBackgroundLocationIndicator: false,
  pausesUpdatesAutomatically: false,
  foregroundService: {
    notificationTitle: "DSE Tracking Active",
    notificationBody: "Sharing location with admin…",
  },
};
