const searchForm = document.getElementById("searchForm");
const cityInput = document.getElementById("city");
const submitBtn = document.getElementById("submitBtn");
const cityName = document.getElementById("cityName");
const locationMeta = document.getElementById("locationMeta");
const statusBox = document.getElementById("status");
const loading = document.getElementById("loading");
const citiesBody = document.getElementById("citiesBody");

const commonCities = ["Agra, India", "Delhi, India", "Mumbai, India", "Lucknow, India", "Kolkata, India"];
const cache = new Map();

const $ = (id) => document.getElementById(id);

function showStatus(message, type = "danger") {
  statusBox.className = `alert alert-${type}`;
  statusBox.textContent = message;
}

function hideStatus() {
  statusBox.className = "alert d-none";
  statusBox.textContent = "";
}

function setLoading(active) {
  loading.classList.toggle("d-none", !active);
  submitBtn.disabled = active;
  submitBtn.textContent = active ? "Loading..." : "Search";
}

function number(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function directionName(degrees) {
  const deg = Number(degrees);
  if (!Number.isFinite(deg)) return "--";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

// Open-Meteo returns local times when timezone=auto.
// Do not use new Date() here because the browser would interpret a timezone-less
// value using the user's own timezone, which can make sunrise/sunset incorrect.
function formatLocalApiTime(value) {
  if (!value || typeof value !== "string") return "--";
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return "--";
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatLocalApiDateTime(value) {
  if (!value || typeof value !== "string") return "";
  const [date, time] = value.split("T");
  if (!date || !time) return "";
  return `${date} ${time.slice(0, 5)}`;
}

function weatherDescription(code) {
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };
  return map[Number(code)] ?? "Unknown conditions";
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Weather service error (${response.status})`);
  return response.json();
}

function normalize(text) {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function parseLocationInput(input) {
  const parts = input.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    name: parts[0] || input.trim(),
    qualifier: parts.slice(1).join(", ")
  };
}

function chooseBestPlace(results, requestedName) {
  const wanted = normalize(requestedName);
  return [...results].sort((a, b) => {
    const aExact = normalize(a.name) === wanted ? 1 : 0;
    const bExact = normalize(b.name) === wanted ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aCity = /PPL|PPLA|PPLC/.test(a.feature_code || "") ? 1 : 0;
    const bCity = /PPL|PPLA|PPLC/.test(b.feature_code || "") ? 1 : 0;
    if (aCity !== bCity) return bCity - aCity;

    return Number(b.population || 0) - Number(a.population || 0);
  })[0];
}

async function geocodeCity(input) {
  const cleaned = input.trim();
  const cacheKey = `geo:${normalize(cleaned)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const { name, qualifier } = parseLocationInput(cleaned);
  const params = new URLSearchParams({
    name: cleaned,
    count: "10",
    language: "en",
    format: "json"
  });

  // An explicit country code makes matching unambiguous.
  const upperQualifier = qualifier.toUpperCase();
  if (upperQualifier === "IN" || normalize(qualifier) === "india") {
    params.set("name", name);
    params.set("countryCode", "IN");
  }

  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new Error(`Location "${cleaned}" was not found. Try "City, Country".`);
  }

  const place = chooseBestPlace(data.results, name);
  cache.set(cacheKey, place);
  return place;
}

async function fetchWeather(place) {
  const cacheKey = `weather:${place.latitude},${place.longitude}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code"
    ].join(","),
    daily: [
      "temperature_2m_min",
      "temperature_2m_max",
      "sunrise",
      "sunset"
    ].join(","),
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: "auto",
    forecast_days: "1"
  });

  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  cache.set(cacheKey, data);
  return data;
}

function renderMainWeather(place, data) {
  const current = data.current || {};
  const daily = data.daily || {};

  cityName.textContent = place.name;
  const location = [place.admin1, place.country].filter(Boolean).join(", ");
  locationMeta.textContent = `${location || "Selected location"} • ${data.timezone || place.timezone || "Local time"}`;

  $("temp").textContent = number(current.temperature_2m);
  $("feelsLike").textContent = number(current.apparent_temperature);
  $("condition").textContent = weatherDescription(current.weather_code);
  $("minTemp").textContent = number(daily.temperature_2m_min?.[0]);
  $("maxTemp").textContent = number(daily.temperature_2m_max?.[0]);
  $("humidity").textContent = number(current.relative_humidity_2m, 0);
  $("cloudCover").textContent = number(current.cloud_cover, 0);
  $("windSpeed").textContent = number(current.wind_speed_10m);
  $("windDirection").textContent = directionName(current.wind_direction_10m);
  $("sunrise").textContent = formatLocalApiTime(daily.sunrise?.[0]);
  $("sunset").textContent = formatLocalApiTime(daily.sunset?.[0]);

  const updated = formatLocalApiDateTime(current.time);
  $("updatedAt").textContent = updated
    ? `Model update time: ${updated} • Local time zone: ${data.timezone} • Units: °C and km/h`
    : "";
}

function getTableWeather(data) {
  const current = data.current || {};
  const daily = data.daily || {};
  return {
    temp: number(current.temperature_2m),
    feels: number(current.apparent_temperature),
    humidity: number(current.relative_humidity_2m, 0),
    min: number(daily.temperature_2m_min?.[0]),
    max: number(daily.temperature_2m_max?.[0]),
    wind: number(current.wind_speed_10m),
    condition: weatherDescription(current.weather_code)
  };
}

async function loadCity(city) {
  if (!city.trim()) throw new Error("Please enter a city name.");
  const place = await geocodeCity(city);
  const weather = await fetchWeather(place);
  renderMainWeather(place, weather);
  return { place, weather };
}

async function renderCommonCities() {
  citiesBody.innerHTML = commonCities.map((city) => `
    <tr><th>${escapeHtml(city.split(",")[0])}</th><td colspan="7">Loading...</td></tr>
  `).join("");

  await Promise.all(commonCities.map(async (city, index) => {
    const row = citiesBody.rows[index];
    try {
      const { weather } = await loadCityDataOnly(city);
      const values = getTableWeather(weather);
      const name = city.split(",")[0];
      row.innerHTML = `
        <th>${escapeHtml(name)}</th>
        <td>${values.temp}°C</td>
        <td>${values.feels}°C</td>
        <td>${values.humidity}%</td>
        <td>${values.min}°C</td>
        <td>${values.max}°C</td>
        <td>${values.wind} km/h</td>
        <td>${escapeHtml(values.condition)}</td>
      `;
    } catch {
      row.innerHTML = `<th>${escapeHtml(city.split(",")[0])}</th><td colspan="7" class="text-danger">Unavailable</td>`;
    }
  }));
}

async function loadCityDataOnly(city) {
  const place = await geocodeCity(city);
  const weather = await fetchWeather(place);
  return { place, weather };
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideStatus();
  setLoading(true);

  try {
    const { place } = await loadCity(cityInput.value);
    cityInput.value = `${place.name}, ${place.country_code}`;
  } catch (error) {
    showStatus(error.message || "Unable to load weather data.");
  } finally {
    setLoading(false);
  }
});

(async function init() {
  setLoading(true);
  try {
    await loadCity("Delhi, India");
  } catch (error) {
    showStatus(error.message || "Unable to load weather data.");
  } finally {
    setLoading(false);
  }
  renderCommonCities();
})();
