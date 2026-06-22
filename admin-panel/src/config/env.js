const ENV = {
  API_URL: import.meta.env.VITE_API_URL || 'https://barber-engine-v1.onrender.com',
  APP_NAME: import.meta.env.VITE_APP_NAME || 'Barber Engine',
  APP_VERSION: '1.0.0',
  IS_DEV: import.meta.env.DEV,
}

export default ENV
