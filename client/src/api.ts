import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000'
});

api.interceptors.request.use(config => {
  console.log('[CLIENT] HTTP request', {
    method: config.method,
    url: config.url,
    data: config.data
  });
  return config;
});

api.interceptors.response.use(
  response => {
    console.log('[CLIENT] HTTP response', {
      url: response.config.url,
      status: response.status,
      data: response.data
    });
    return response;
  },
  error => {
    console.error('[CLIENT] HTTP error', error);
    return Promise.reject(error);
  }
);
