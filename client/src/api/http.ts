import axios from 'axios';

function resolveApiBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname || 'localhost';
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    if (isLocalhost) {
      const protocol = 'http:';
      const port = import.meta.env.VITE_API_PORT || '4000';
      return `${protocol}//${hostname}:${port}`;
    }
    return `${window.location.protocol}//${window.location.host}`;
  }
  return 'http://localhost:4000';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const http = axios.create({
  baseURL: API_BASE_URL,
});

http.interceptors.request.use(config => {
  console.log('[CLIENT] HTTP request', {
    method: config.method,
    url: config.url,
    data: config.data,
  });
  return config;
});

http.interceptors.response.use(
  response => {
    console.log('[CLIENT] HTTP response', {
      url: response.config.url,
      status: response.status,
      data: response.data,
    });
    return response;
  },
  error => {
    console.error('[CLIENT] HTTP error', error);
    return Promise.reject(error);
  }
);
