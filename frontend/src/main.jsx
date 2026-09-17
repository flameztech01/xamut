import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import store from "./store";
import { Provider } from "react-redux";

import { createBrowserRouter, RouterProvider } from 'react-router'

import Welcome from './pages/Welcome.jsx'
import Signup from './pages/Signup.jsx'
import Signin from './pages/Signin.jsx'
import Chat from './pages/Chats.jsx'
import DocumentViewer from './pages/DocumentViewer.jsx'
import ClipViewer from './pages/ClipViewer.jsx';
import PrivateRoute from './components/PrivateRoute.jsx';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'signup', element: <Signup /> },
      { path: 'signin', element: <Signin /> },
      {
        element: <PrivateRoute />,
        children: [
          { path: 'chat', element: <Chat /> },
          { path: 'documents/:id', element: <DocumentViewer /> },
          { path: 'clips/:id', element: <ClipViewer /> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  </Provider>
)