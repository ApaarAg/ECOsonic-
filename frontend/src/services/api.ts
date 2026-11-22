import axios, { AxiosError } from 'axios';

// Environment-based API URL defaulting to standard local proxy /api/v1 or direct host
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    Accept: 'application/json',
  },
});

// Interceptor for standardized error normalization
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string | Array<{ msg: string; loc?: string[] }> }>) => {
    let message = 'An unexpected network error occurred.';
    if (error.response?.data?.detail) {
      const detail = error.response.data.detail;
      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail.map((d) => d.msg).join('; ');
      } else {
        message = JSON.stringify(detail);
      }
    } else if (error.message) {
      message = error.message;
    }
    return Promise.reject(new Error(message));
  }
);

export async function checkSystemHealth() {
  const res = await axios.get('/health', { timeout: 5000 });
  return res.data;
}

export default apiClient;
