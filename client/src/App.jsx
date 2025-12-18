import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CrawlDashboard from './components/CrawlDashboard';
import NewCrawlForm from './components/NewCrawlForm';
import './App.css';

const API_BASE = '/api';

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ws, setWs] = useState(null);

  useEffect(() => {
    fetchJobs();
    connectWebSocket();

    // Poll for updates every 5 seconds as fallback
    const interval = setInterval(fetchJobs, 5000);

    return () => {
      clearInterval(interval);
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const websocket = new WebSocket(wsUrl);

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status_update') {
        // Refresh jobs when status updates
        fetchJobs();
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onclose = () => {
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    setWs(websocket);
  };

  const fetchJobs = async () => {
    try {
      const response = await axios.get(`${API_BASE}/status`);
      setJobs(response.data);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewCrawl = async (websites, maxDepth, maxPages) => {
    try {
      const response = await axios.post(`${API_BASE}/crawl`, {
        websites,
        maxDepth,
        maxPages,
      });
      
      // Refresh jobs list
      await fetchJobs();
      
      return response.data;
    } catch (error) {
      console.error('Error starting crawl:', error);
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🧠 SaaS Sitemap Generator</h1>
        <p>AI-powered multi-website crawling with real-time status</p>
      </header>

      <main className="app-main">
        <NewCrawlForm onSubmit={handleNewCrawl} />
        <CrawlDashboard jobs={jobs} onRefresh={fetchJobs} />
      </main>
    </div>
  );
}

export default App;

