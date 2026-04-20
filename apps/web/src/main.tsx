import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppThemeProvider } from './contexts/ThemeContext.js'
import { AssistantProvider } from './contexts/AssistantContext.js'
import App from './App.js'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppThemeProvider>
        <AssistantProvider>
          <App />
        </AssistantProvider>
      </AppThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
