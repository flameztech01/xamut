import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import store from "./store";
import { Provider } from "react-redux";
import { ThemeProvider } from "./context/ThemeContext.jsx";

import { createBrowserRouter, RouterProvider } from 'react-router'

import Welcome from './pages/Welcome.jsx'
import Signup from './pages/Signup.jsx'
import Signin from './pages/Signin.jsx'
import Chat from './pages/Chats.jsx'
import DocumentViewer from './pages/DocumentViewer.jsx'
import ClipViewer from './pages/ClipViewer.jsx';
import MyForms from './pages/MyForms.jsx';
import FormEditor from './pages/FormEditor.jsx';
import FormResponses from './pages/FormResponses.jsx';
import PublicForm from './pages/PublicForm.jsx';
import WhatsAppSettings from './pages/WhatsappSettings.jsx';
import WhatsAppInbox from './pages/WhatsappInbox.jsx';
import PrivateRoute from './components/PrivateRoute.jsx';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'signup', element: <Signup /> },
      { path: 'signin', element: <Signin /> },

      // ── Public form fill ────────────────────────────────
      // No auth. Participants (and anyone for public forms)
      // land here. The controller decides whether a login
      // screen or the form itself is shown.
      { path: 'forms/:slug', element: <PublicForm /> },

      // ── Authenticated routes ────────────────────────────
      {
        element: <PrivateRoute />,
        children: [
          { path: 'chat', element: <Chat /> },
          { path: 'documents/:id', element: <DocumentViewer /> },
          { path: 'clips/:id', element: <ClipViewer /> },

          // Forms dashboard + owner-side tools
          { path: 'forms', element: <MyForms /> },
          { path: 'forms/:id/edit', element: <FormEditor /> },
          { path: 'forms/:id/responses', element: <FormResponses /> },

          {path: 'whatsapp', element: <WhatsAppInbox />},
          {path: 'whatsapp/:id', element: <WhatsAppInbox />},
          {path: 'settings/whatsapp', element: <WhatsAppSettings />},
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <ThemeProvider>
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    </ThemeProvider>
  </Provider>
)