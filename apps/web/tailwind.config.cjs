/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#f6f7f5",
          100: "#ecefe9",
          200: "#d9e0d6",
          500: "#5f7a5f",
          600: "#4f694f",
          700: "#3d523d"
        }
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)"
      }
    }
  },
  plugins: []
};
