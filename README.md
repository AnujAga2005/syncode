# SynCode 🚀

**Real-time Collaborative IDE with Voice Chat & Code Execution**

SyncCode is a lightweight, real-time collaborative code editor that allows multiple users to write, execute, and debug code simultaneously in a shared environment. Built for developers, students, and interviewers who need seamless sync without the "cursor jumping" issues common in other editors.

![Project Status](https://img.shields.io/badge/status-active-success)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

- **⚡ Real-time Collaboration:** Simultaneous editing with zero latency using Socket.io and granular delta updates (prevents overwriting other users' code).
- **🗣️ Voice Chat:** Integrated WebRTC voice channels to talk while you code.
- **🏃 Code Execution:** Run JavaScript, Python, and Java code directly in the browser (powered by Piston API).
- **🎨 Professional UI:** Clean, dark-themed interface built with Tailwind CSS, featuring syntax highlighting and error tracking.
- **📂 Room Management:** Create instant rooms or join via ID to collaborate privately.
- **💾 Save & Download:** Download your source code files with a single click.

## 🛠️ Tech Stack

**Frontend:**
- **React.js** (Vite)
- **Monaco Editor** (VS Code's editor engine)
- **Tailwind CSS** (Styling)
- **Socket.io-client** (Real-time events)
- **Simple-Peer** (WebRTC for Voice)

**Backend:**
- **Node.js & Express**
- **Socket.io** (WebSocket server)
- **Cors** (Security)

---

## 🚀 Getting Started

Follow these instructions to set up the project locally.

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/synccode.git
cd synccode
```

### 2. Backend Setup
Navigate to the server directory (create one if your structure differs, or use the root if it's a mono-repo).

```bash
cd server  # or wherever index.ts is located
npm install
```

Create a `.env` file in the backend directory:
```env
PORT=3001
FRONTEND_URL=http://localhost:5173
```

Run the server:
```bash
npm run dev
# or
node index.ts
```

### 3. Frontend Setup
Navigate to the client directory.

```bash
cd client
npm install
```

Create a `.env` file in the client root:
```env
VITE_BACKEND_URL=http://localhost:3001
```

Run the frontend:
```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 🔧 Environment Variables

### Backend (`.env`)
| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the Socket.io server runs on. | `3001` |
| `FRONTEND_URL` | The URL of your React frontend (for CORS). | `http://localhost:5173` |

### Frontend (`.env`)
| Variable | Description |
| :--- | :--- |
| `VITE_BACKEND_URL` | The URL of your Node.js backend. |

---

## 🐛 Troubleshooting

**1. "Microphone Blocked" Error:**
Browsers block microphone access on non-secure (HTTP) origins unless it is `localhost`. If you are testing on mobile or a different device on your network, you must use **HTTPS**.
- **Solution:** Use [Ngrok](https://ngrok.com/) to tunnel your local server:
  ```bash
  ngrok http 5173
  ```

**2. Cursor Jumping / Text Overwriting:**
This project uses **Delta Updates** (sending only changes, not the full file) to solve this. If you experience issues, ensure your internet connection is stable, as high packet loss can desync sockets.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Built with ❤️ by Anuj Agarwal**
