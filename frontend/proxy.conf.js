// Dev proxy for `ng serve`: forwards /api to the pose backend.
//
//   BACKEND_PORT=9099 npx ng serve             a backend moved off :8080
//   BACKEND_URL=http://192.168.1.20:8080 ...   someone else's backend (the
//                                              Act 3 stretch: race over Wi-Fi)
const target = process.env.BACKEND_URL || `http://localhost:${process.env.BACKEND_PORT || 8080}`;

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
  },
};
