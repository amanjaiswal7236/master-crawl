import React, { useState } from 'react';
import JobDetails from './JobDetails';
import './CrawlDashboard.css';

function CrawlDashboard({ jobs, onRefresh }) {
  const [selectedJob, setSelectedJob] = useState(null);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'PENDING':
        return '⏳';
      case 'CRAWLING':
        return '🕷️';
      case 'PROCESSING':
        return '⚙️';
      case 'AI_ANALYSIS':
        return '🤖';
      case 'COMPLETED':
        return '✅';
      case 'FAILED':
        return '❌';
      default:
        return '⏸️';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING':
        return '#ffa500';
      case 'CRAWLING':
        return '#2196f3';
      case 'PROCESSING':
        return '#9c27b0';
      case 'AI_ANALYSIS':
        return '#673ab7';
      case 'COMPLETED':
        return '#4caf50';
      case 'FAILED':
        return '#f44336';
      default:
        return '#999';
    }
  };

  const formatProgress = (pagesCrawled, maxPages) => {
    if (maxPages === 0) return '0%';
    const percent = Math.min(100, Math.round((pagesCrawled / maxPages) * 100));
    return `${percent}%`;
  };

  if (jobs.length === 0) {
    return (
      <div className="crawl-dashboard">
        <div className="empty-state">
          <p>No crawl jobs yet. Start a new crawl to begin!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="crawl-dashboard">
      <div className="dashboard-header">
        <h2>Crawl Status Dashboard</h2>
        <button onClick={onRefresh} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>

      <div className="table-container">
        <table className="status-table">
          <thead>
            <tr>
              <th>Website</th>
              <th>Status</th>
              <th>Pages</th>
              <th>Depth</th>
              <th>Progress</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className={selectedJob?.id === job.id ? 'selected' : ''}>
                <td>
                  <a
                    href={job.website.startsWith('http') ? job.website : `https://${job.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="website-link"
                  >
                    {job.website}
                  </a>
                </td>
                <td>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(job.status) }}
                  >
                    {getStatusIcon(job.status)} {job.status}
                  </span>
                </td>
                <td>
                  {job.pagesCrawled || 0} / {job.maxPages}
                </td>
                <td>{job.depth}</td>
                <td>
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar"
                      style={{
                        width: formatProgress(job.pagesCrawled, job.maxPages),
                        backgroundColor: getStatusColor(job.status),
                      }}
                    />
                    <span className="progress-text">
                      {formatProgress(job.pagesCrawled, job.maxPages)}
                    </span>
                  </div>
                </td>
                <td>
                  <button
                    onClick={() => setSelectedJob(job)}
                    className="view-btn"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedJob && (
        <JobDetails
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}

export default CrawlDashboard;

