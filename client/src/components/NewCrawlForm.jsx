import React, { useState } from 'react';
import './NewCrawlForm.css';

function NewCrawlForm({ onSubmit }) {
  const [websites, setWebsites] = useState(['']);
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleWebsiteChange = (index, value) => {
    const newWebsites = [...websites];
    newWebsites[index] = value;
    setWebsites(newWebsites);
  };

  const addWebsite = () => {
    setWebsites([...websites, '']);
  };

  const removeWebsite = (index) => {
    if (websites.length > 1) {
      const newWebsites = websites.filter((_, i) => i !== index);
      setWebsites(newWebsites);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    
    const validWebsites = websites.filter(w => w.trim());
    if (validWebsites.length === 0) {
      setError('Please add at least one website');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(validWebsites, maxDepth, maxPages);
      setSuccess(true);
      setWebsites(['']);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to start crawl');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-crawl-form-container">
      <form className="new-crawl-form" onSubmit={handleSubmit}>
        <h2>Start New Crawl</h2>
        
        <div className="form-group">
          <label>Websites to Crawl</label>
          {websites.map((website, index) => (
            <div key={index} className="website-input-group">
              <input
                type="text"
                placeholder="https://example.com"
                value={website}
                onChange={(e) => handleWebsiteChange(index, e.target.value)}
                disabled={loading}
              />
              {websites.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeWebsite(index)}
                  className="remove-btn"
                  disabled={loading}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addWebsite}
            className="add-website-btn"
            disabled={loading}
          >
            + Add Another Website
          </button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Max Depth</label>
            <input
              type="number"
              min="1"
              max="10"
              value={maxDepth}
              onChange={(e) => setMaxDepth(parseInt(e.target.value))}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>Max Pages</label>
            <input
              type="number"
              min="1"
              max="10000"
              value={maxPages}
              onChange={(e) => setMaxPages(parseInt(e.target.value))}
              disabled={loading}
            />
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">✅ Crawl started successfully!</div>}

        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? 'Starting...' : 'Start Crawl'}
        </button>
      </form>
    </div>
  );
}

export default NewCrawlForm;

