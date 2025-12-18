import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './JobDetails.css';

function JobDetails({ job, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [sitemapView, setSitemapView] = useState('original');

  useEffect(() => {
    fetchDetails();
  }, [job.id]);

  const fetchDetails = async () => {
    try {
      const response = await axios.get(`/api/crawl/${job.id}`);
      setDetails(response.data);
    } catch (error) {
      console.error('Error fetching job details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="job-details-overlay">
        <div className="job-details-modal">
          <div className="loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (!details) {
    return null;
  }

  return (
    <div className="job-details-overlay" onClick={onClose}>
      <div className="job-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{job.website}</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-tabs">
          <button
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={activeTab === 'recommendations' ? 'active' : ''}
            onClick={() => setActiveTab('recommendations')}
          >
            AI Recommendations ({details.recommendations?.length || 0})
          </button>
          <button
            className={activeTab === 'sitemap' ? 'active' : ''}
            onClick={() => setActiveTab('sitemap')}
          >
            Sitemap
          </button>
        </div>

        <div className="modal-content">
          {activeTab === 'overview' && (
            <div className="overview-tab">
              <div className="info-grid">
                <div className="info-item">
                  <label>Status</label>
                  <span className="status-value">{details.status}</span>
                </div>
                <div className="info-item">
                  <label>Pages Crawled</label>
                  <span>{details.pagesCount || 0}</span>
                </div>
                <div className="info-item">
                  <label>Max Depth</label>
                  <span>{details.max_depth}</span>
                </div>
                <div className="info-item">
                  <label>Max Pages</label>
                  <span>{details.max_pages}</span>
                </div>
                <div className="info-item">
                  <label>Started At</label>
                  <span>{details.started_at ? new Date(details.started_at).toLocaleString() : 'N/A'}</span>
                </div>
                <div className="info-item">
                  <label>Completed At</label>
                  <span>{details.completed_at ? new Date(details.completed_at).toLocaleString() : 'N/A'}</span>
                </div>
              </div>
              {details.error_message && (
                <div className="error-box">
                  <strong>Error:</strong> {details.error_message}
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="recommendations-tab">
              {details.recommendations && details.recommendations.length > 0 ? (
                <table className="recommendations-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.recommendations.map((rec) => (
                      <tr key={rec.id}>
                        <td>
                          <span className="category-badge">{rec.category}</span>
                        </td>
                        <td>
                          <pre>{JSON.stringify(rec.before, null, 2)}</pre>
                        </td>
                        <td>
                          <pre>{JSON.stringify(rec.after, null, 2)}</pre>
                        </td>
                        <td>{rec.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">
                  {details.status === 'AI_ANALYSIS' || details.status === 'PROCESSING'
                    ? 'AI analysis in progress...'
                    : 'No recommendations available yet.'}
                </div>
              )}
            </div>
          )}

          {activeTab === 'sitemap' && (
            <div className="sitemap-tab">
              {details.sitemap ? (
                <div>
                  <div className="sitemap-actions">
                    <div className="sitemap-toggle">
                      <button
                        className={sitemapView === 'original' ? 'active' : ''}
                        onClick={() => setSitemapView('original')}
                      >
                        Original
                      </button>
                      <button
                        className={sitemapView === 'optimized' ? 'active' : ''}
                        onClick={() => setSitemapView('optimized')}
                      >
                        Optimized
                      </button>
                    </div>
                    <div className="download-buttons">
                      <a
                        href={`/api/crawl/${job.id}/download/json`}
                        download
                        className="download-btn"
                      >
                        📥 Download JSON
                      </a>
                      <a
                        href={`/api/crawl/${job.id}/download/xml`}
                        download
                        className="download-btn"
                      >
                        📥 Download XML
                      </a>
                      <a
                        href={`/api/crawl/${job.id}/download/tree`}
                        download
                        className="download-btn"
                      >
                        📥 Download Tree
                      </a>
                    </div>
                  </div>
                  <pre className="sitemap-json">
                    {JSON.stringify(
                      sitemapView === 'optimized' && details.sitemap.optimized_sitemap
                        ? details.sitemap.optimized_sitemap
                        : details.sitemap.original_sitemap,
                      null,
                      2
                    )}
                  </pre>
                </div>
              ) : (
                <div className="empty-state">Sitemap not available yet.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default JobDetails;

