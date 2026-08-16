# Technical Details: Workspace Platform

This document outlines the technical architecture, stack, and core functionalities of the Workspace Platform application.

## 1. Tech Stack & Architecture

The application is built as a **Full-Stack Application** using a unified monorepo structure.

### Frontend
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS for utility-first styling and responsive design.
- **Animations:** `motion/react` (Framer Motion) for fluid UI transitions, staggered list loading, and modal animations.
- **Icons:** `lucide-react` for consistent, crisp vector icons.
- **State Management:** React Hooks (`useState`, `useEffect`, `useRef`) for managing local component state, including file lists, drag-and-drop interactions, and theme toggling.

### Backend
- **Server:** Node.js with Express (configured in `server.ts`).
- **Database:** SQLite via `better-sqlite3` (`db.ts`, file `desboard.db`) stores files, projects, and tags so data survives a refresh; seeded automatically on first run.
- **Development Middleware:** Vite is mounted as a middleware in development (`NODE_ENV !== "production"`) to serve the frontend and handle Hot Module Replacement seamlessly alongside API routes.
- **Production Build:** The Express server is bundled using `esbuild` to a standalone CommonJS file (`dist/server.cjs`), and Vite builds the static frontend into `dist/`.

## 2. Core Features & Capabilities

### File & Vault Management
- **Interactive UI:** Supports both Grid and List views for files.
- **Drag-and-Drop:** Native HTML5 Drag and Drop API is utilized to allow users to drag files and drop them into project folders seamlessly.
- **Stateful Filtering:** Projects and tags act as state filters, instantly updating the visible files without requiring network requests.

### AI Integration (Anthropic Claude)
The platform integrates the official `@anthropic-ai/sdk` package on the Express backend, exposing secure API routes that keep `ANTHROPIC_API_KEY` hidden from the client.
- **Semantic File Search (`/api/search`):** Uses the `claude-haiku-4-5` model for rapid file retrieval. The backend sends a compact index (file names, tags, status, type) plus the user's query, and Claude returns a ranked JSON array of matching file ids. Falls back to plain keyword matching if the AI call fails.
- **Project & File Copilot (`/api/chat`):** Uses the `claude-sonnet-4-6` model. The frontend passes the selected file or project as context along with the prompt, enabling Claude to draft client updates, summarize files, and analyze timeline risks.
- **Upload Analysis (`/api/analyze`):** Uses `claude-sonnet-4-6` to suggest a summary and tags for newly uploaded files (images and PDFs are analyzed from their real content).

### Accessibility & Theming
- **Dynamic Theming:** Features a custom CSS-filter-based light mode toggle (`invert(1) hue-rotate(180deg)`) that instantly flips the dark, high-contrast UI into an accessible light mode.
- **Responsive Layout:** The dashboard utilizes flexbox, CSS Grid, and responsive Tailwind breakpoints (`md:`, `lg:`) to scale from small viewports to expansive desktop displays.

## 3. Data Flow

1. **Client Interaction:** User interacts with the UI (e.g., types a search query or asks the AI Copilot a question).
2. **API Request:** The React frontend sends an HTTP POST request to the corresponding Express route (`/api/search` or `/api/chat`), passing contextual JSON payloads.
3. **AI Processing:** The Express server securely invokes the Gemini API using `process.env.GEMINI_API_KEY`.
4. **Response & Update:** The server returns the generated content or search results to the client, which dynamically updates the React state and triggers animation sequences.
