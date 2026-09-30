const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REVERSE_GEOCODING_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const elements = {
  searchForm: document.querySelector("#search-form"),
  citySearch: document.querySelector("#city-search"),
  searchButton: document.querySelector("#search-form button[type='submit']"),
  searchStatus: document.querySelector("#search-status"),
  citySuggestions: document.querySelector("#city-suggestions"),
  weatherContent: document.querySelector("#weather-content"),
  noResultsState: document.querySelector("#no-results-state"),
  apiErrorState: document.querySelector("#api-error-state"),
  retryButton: document.querySelector("#retry-button"),
  unitsMenu: document.querySelector("#units-menu"),
  unitsPresetButton: document.querySelector("#units-preset-button"),
  forecastDaySelect: document.querySelector("#forecast-day-select"),
  currentCity: document.querySelector("#current-city"),
  currentDate: document.querySelector("#current-date"),
  currentCondition: document.querySelector("#current-condition"),
  currentIcon: document.querySelector("#current-icon"),
  currentTemperature: document.querySelector("#current-temperature"),
  feelsLike: document.querySelector("#feels-like"),
  humidity: document.querySelector("#humidity"),
  windSpeed: document.querySelector("#wind-speed"),
  windUnitLabel: document.querySelector("#wind-unit-label"),
  precipitation: document.querySelector("#precipitation"),
  precipitationUnitLabel: document.querySelector("#precipitation-unit-label"),
  dailyForecastList: document.querySelector("#daily-forecast-list"),
  hourlyForecastList: document.querySelector("#hourly-forecast-list")
};

const state = {
  cityQuery: "",
  lastRequest: "Berlin",
  location: null,
  forecast: null,
  suggestions: [],
  activeSuggestionIndex: -1,
  selectedDayIndex: 0,
  requestId: 0,
  suggestionRequestId: 0,
  suggestionTimer: null,
  units: {
    temperature: "celsius",
    wind: "kmh",
    precipitation: "mm"
  }
};

const WEATHER_TYPES = [
  { codes: [0], label: "Clear sky", icon: "icon-sunny.webp" },
  { codes: [1, 2], label: "Partly cloudy", icon: "icon-partly-cloudy.webp" },
  { codes: [3], label: "Overcast", icon: "icon-overcast.webp" },
  { codes: [45, 48], label: "Fog", icon: "icon-fog.webp" },
  { codes: [51, 53, 55, 56, 57], label: "Drizzle", icon: "icon-drizzle.webp" },
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], label: "Rain", icon: "icon-rain.webp" },
  { codes: [71, 73, 75, 77, 85, 86], label: "Snow", icon: "icon-snow.webp" },
  { codes: [95, 96, 99], label: "Thunderstorm", icon: "icon-storm.webp" }
];

function getWeatherType(code) {
  return WEATHER_TYPES.find((type) => type.codes.includes(code)) || {
    label: "Cloudy",
    icon: "icon-overcast.webp"
  };
}

function setStatus(message = "") {
  elements.searchStatus.textContent = message;
  elements.searchStatus.hidden = !message;
}

function setView(view) {
  const isWeatherVisible = view === "weather" || view === "loading";
  elements.weatherContent.hidden = !isWeatherVisible;
  elements.weatherContent.classList.toggle("is-loading", view === "loading");
  elements.weatherContent.setAttribute("aria-busy", String(view === "loading"));
  elements.noResultsState.hidden = view !== "no-results";
  elements.apiErrorState.hidden = view !== "api-error";
}

function hideSuggestions() {
  elements.citySuggestions.hidden = true;
  elements.citySuggestions.replaceChildren();
  elements.citySearch.setAttribute("aria-expanded", "false");
  elements.citySearch.removeAttribute("aria-activedescendant");
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather request failed (${response.status})`);
  }
  return response.json();
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1000,
      timeout: 10000
    });
  });
}

async function getCurrentLocation() {
  const position = await getBrowserPosition();
  const { latitude, longitude } = position.coords;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: "en"
  });
  let place = {};
  try {
    place = await fetchJson(`${REVERSE_GEOCODING_URL}?${params}`);
  } catch (error) {
    console.info("Reverse geocoding is unavailable; showing coordinates-based weather.", error);
  }

  return {
    name: place.city || place.locality || place.principalSubdivision || "My location",
    admin1: place.city ? place.principalSubdivision : "",
    country: place.countryName || "",
    latitude,
    longitude
  };
}

async function findLocations(query) {
  const drcParams = new URLSearchParams({
    name: query,
    count: "8",
    language: "fr",
    format: "json",
    countryCode: "CD"
  });
  const drcData = await fetchJson(`${GEOCODING_URL}?${drcParams}`);
  if (drcData.results?.length) return drcData.results;

  const globalParams = new URLSearchParams({
    name: query,
    count: "8",
    language: "fr",
    format: "json"
  });
  const globalData = await fetchJson(`${GEOCODING_URL}?${globalParams}`);
  return globalData.results || [];
}

async function getForecast(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "is_day"
    ].join(","),
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    temperature_unit: state.units.temperature,
    wind_speed_unit: state.units.wind,
    precipitation_unit: state.units.precipitation,
    timezone: "auto",
    forecast_days: "7"
  });
  return fetchJson(`${FORECAST_URL}?${params}`);
}

function formatDate(dateString, options) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", options).format(new Date(year, month - 1, day, 12));
}

function formatHour(timeString) {
  const [hour, minute] = timeString.split("T")[1].split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute === 0 ? undefined : "2-digit"
  }).format(new Date(2000, 0, 1, hour, minute));
}

function formatLocation(location) {
  const parts = [location.name];
  if (location.admin1 && location.admin1 !== location.name) parts.push(location.admin1);
  if (location.country) parts.push(location.country);
  return parts.join(", ");
}

function createWeatherIcon(code, className = "") {
  const weather = getWeatherType(code);
  const image = document.createElement("img");
  image.src = `./assets/images/${weather.icon}`;
  image.alt = weather.label;
  if (className) image.className = className;
  return image;
}

function renderCurrentWeather() {
  const current = state.forecast.current;
  const weather = getWeatherType(current.weather_code);

  elements.currentCity.textContent = formatLocation(state.location);
  elements.currentDate.textContent = formatDate(current.time.slice(0, 10), {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  elements.currentCondition.textContent = weather.label;
  elements.currentIcon.src = `./assets/images/${weather.icon}`;
  elements.currentIcon.alt = weather.label;
  elements.currentTemperature.textContent = Math.round(current.temperature_2m);
  elements.feelsLike.textContent = Math.round(current.apparent_temperature);
  elements.humidity.textContent = current.relative_humidity_2m;
  elements.windSpeed.textContent = Math.round(current.wind_speed_10m);
  elements.precipitation.textContent = Number(current.precipitation).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
  elements.windUnitLabel.textContent = state.units.wind === "mph" ? "mph" : "km/h";
  elements.precipitationUnitLabel.textContent = state.units.precipitation === "inch" ? "in" : "mm";
}

function renderDailyForecast() {
  const { time, weather_code: codes, temperature_2m_max: highs, temperature_2m_min: lows } = state.forecast.daily;
  const fragment = document.createDocumentFragment();

  time.forEach((date, index) => {
    const card = document.createElement("article");
    card.className = "forecast-day";

    const dayName = document.createElement("h3");
    dayName.textContent = formatDate(date, { weekday: "short" });

    const temperatures = document.createElement("p");
    const high = document.createElement("span");
    const low = document.createElement("span");
    high.textContent = `${Math.round(highs[index])}°`;
    low.textContent = `${Math.round(lows[index])}°`;
    temperatures.append(high, low);

    card.append(dayName, createWeatherIcon(codes[index]), temperatures);
    fragment.append(card);
  });

  elements.dailyForecastList.replaceChildren(fragment);
}

function renderDayOptions() {
  const fragment = document.createDocumentFragment();

  state.forecast.daily.time.forEach((date, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = formatDate(date, { weekday: "long" });
    fragment.append(option);
  });

  elements.forecastDaySelect.replaceChildren(fragment);
  elements.forecastDaySelect.value = String(state.selectedDayIndex);
}

function renderHourlyForecast() {
  const { time, temperature_2m: temperatures, weather_code: codes } = state.forecast.hourly;
  const selectedDate = state.forecast.daily.time[state.selectedDayIndex];
  const matchingHours = time
    .map((hour, index) => ({ hour, temperature: temperatures[index], code: codes[index] }))
    .filter((entry) => entry.hour.startsWith(`${selectedDate}T`));

  const now = state.forecast.current.time;
  const isToday = selectedDate === now.slice(0, 10);
  const currentHour = Number(now.slice(11, 13));
  const firstHour = isToday ? currentHour : 15;
  const foundStart = matchingHours.findIndex((entry) => Number(entry.hour.slice(11, 13)) >= firstHour);
  const visibleHours = matchingHours.slice(Math.max(0, foundStart), Math.max(0, foundStart) + 8);
  const fragment = document.createDocumentFragment();

  visibleHours.forEach((entry) => {
    const row = document.createElement("article");
    row.className = "forecast-hour";
    const timeLabel = document.createElement("h3");
    timeLabel.textContent = formatHour(entry.hour);
    const temperature = document.createElement("p");
    temperature.textContent = `${Math.round(entry.temperature)}°`;
    row.append(createWeatherIcon(entry.code), timeLabel, temperature);
    fragment.append(row);
  });

  elements.hourlyForecastList.replaceChildren(fragment);
}

function renderForecast() {
  renderCurrentWeather();
  renderDailyForecast();
  renderDayOptions();
  renderHourlyForecast();
}

function renderSuggestions(locations) {
  state.suggestions = locations.slice(0, 5);
  state.activeSuggestionIndex = -1;
  const fragment = document.createDocumentFragment();

  state.suggestions.forEach((location, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `city-suggestion-${index}`;
    option.className = "city-suggestion";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = formatLocation(location);
    option.addEventListener("click", () => selectLocation(location));
    fragment.append(option);
  });

  elements.citySuggestions.replaceChildren(fragment);
  elements.citySuggestions.hidden = state.suggestions.length === 0;
  elements.citySearch.setAttribute("aria-expanded", String(state.suggestions.length > 0));
}

function setActiveSuggestion(index) {
  const options = [...elements.citySuggestions.querySelectorAll(".city-suggestion")];
  if (!options.length) return;

  state.activeSuggestionIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    option.setAttribute("aria-selected", String(optionIndex === state.activeSuggestionIndex));
  });
  elements.citySearch.setAttribute("aria-activedescendant", options[state.activeSuggestionIndex].id);
  options[state.activeSuggestionIndex].scrollIntoView({ block: "nearest" });
}

function selectLocation(location) {
  elements.citySearch.value = location.name;
  hideSuggestions();
  setStatus("");
  loadWeather(location);
}

async function updateSuggestions(query, requestId) {
  try {
    const locations = await findLocations(query);
    if (requestId !== state.suggestionRequestId) return;
    setStatus("");
    renderSuggestions(locations);
    if (!locations.length) setStatus("No matching cities found.");
  } catch (error) {
    if (requestId !== state.suggestionRequestId) return;
    console.error(error);
    hideSuggestions();
    setStatus("Suggestions are unavailable. Press Search to try again.");
  }
}

async function loadWeather(queryOrLocation) {
  const isLocation = typeof queryOrLocation === "object" && queryOrLocation !== null;
  const query = isLocation ? queryOrLocation.name : queryOrLocation.trim();
  if (!query) return;

  clearTimeout(state.suggestionTimer);
  state.suggestionRequestId += 1;
  const requestId = ++state.requestId;
  state.cityQuery = query;
  state.lastRequest = queryOrLocation;
  hideSuggestions();
  setStatus("");
  setView("loading");
  elements.searchButton.disabled = true;

  try {
    const location = isLocation ? queryOrLocation : (await findLocations(query))[0];
    if (requestId !== state.requestId) return;
    if (!location) {
      setView("no-results");
      return;
    }

    const forecast = await getForecast(location);
    if (requestId !== state.requestId) return;

    state.location = location;
    state.forecast = forecast;
    state.selectedDayIndex = 0;
    renderForecast();
    setView("weather");
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.error(error);
    setView("api-error");
  } finally {
    if (requestId === state.requestId) elements.searchButton.disabled = false;
  }
}

function readSelectedUnits() {
  state.units.temperature = document.querySelector("input[name='temperature-unit']:checked").value;
  state.units.wind = document.querySelector("input[name='wind-unit']:checked").value;
  state.units.precipitation = document.querySelector("input[name='precipitation-unit']:checked").value;
  const isMetric = state.units.temperature === "celsius" && state.units.wind === "kmh" && state.units.precipitation === "mm";
  elements.unitsPresetButton.textContent = isMetric ? "Switch to Imperial" : "Switch to Metric";
}

function applyUnitPreset() {
  const isMetric = state.units.temperature === "celsius" && state.units.wind === "kmh" && state.units.precipitation === "mm";
  const preset = isMetric
    ? { temperature: "fahrenheit", wind: "mph", precipitation: "inch" }
    : { temperature: "celsius", wind: "kmh", precipitation: "mm" };

  Object.entries(preset).forEach(([unit, value]) => {
    document.querySelector(`input[name='${unit === "temperature" ? "temperature" : unit}-unit'][value='${value}']`).checked = true;
  });
  readSelectedUnits();
  elements.unitsMenu.open = false;
  loadWeather(state.location || state.lastRequest);
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.suggestionRequestId += 1;
  if (state.activeSuggestionIndex >= 0 && state.suggestions[state.activeSuggestionIndex]) {
    selectLocation(state.suggestions[state.activeSuggestionIndex]);
    return;
  }
  loadWeather(elements.citySearch.value);
});

elements.citySearch.addEventListener("input", () => {
  const query = elements.citySearch.value.trim();
  clearTimeout(state.suggestionTimer);
  const requestId = ++state.suggestionRequestId;
  hideSuggestions();

  if (query.length < 2) {
    setStatus("");
    return;
  }

  setStatus("Search in progress…");
  state.suggestionTimer = setTimeout(() => updateSuggestions(query, requestId), 250);
});

elements.citySearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && state.suggestions.length) {
    event.preventDefault();
    setActiveSuggestion(state.activeSuggestionIndex + 1);
  } else if (event.key === "ArrowUp" && state.suggestions.length) {
    event.preventDefault();
    setActiveSuggestion(state.activeSuggestionIndex <= 0 ? state.suggestions.length - 1 : state.activeSuggestionIndex - 1);
  } else if (event.key === "Escape") {
    hideSuggestions();
    setStatus("");
  }
});

document.addEventListener("click", (event) => {
  if (!elements.searchForm.contains(event.target)) hideSuggestions();
});

elements.forecastDaySelect.addEventListener("change", () => {
  state.selectedDayIndex = Number(elements.forecastDaySelect.value);
  if (state.forecast) renderHourlyForecast();
});

elements.unitsMenu.addEventListener("change", (event) => {
  if (!event.target.matches("input[type='radio']")) return;
  readSelectedUnits();
  elements.unitsMenu.open = false;
  loadWeather(state.location || state.lastRequest);
});

elements.unitsPresetButton.addEventListener("click", applyUnitPreset);
elements.retryButton.addEventListener("click", () => loadWeather(state.lastRequest));

async function loadInitialWeather() {
  const startupRequestId = ++state.requestId;
  setView("loading");

  try {
    const location = await getCurrentLocation();
    if (startupRequestId !== state.requestId) return;
    await loadWeather(location);
  } catch (error) {
    if (startupRequestId !== state.requestId) return;
    console.info("Could not detect the user's location; using Kinshasa instead.", error);
    await loadWeather("Kinshasa");
    if (startupRequestId + 1 === state.requestId) {
      setStatus("Location unavailable. Showing weather for Kinshasa.");
    }
  }
}

readSelectedUnits();
loadInitialWeather();
