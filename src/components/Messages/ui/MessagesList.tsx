import React, { useEffect, useState, useRef } from 'react';
import { Message } from '../../../types';
import { ExternalLink, BarChart2 } from 'lucide-react';

interface MessagesListProps {
  messages: Message[];
  loading: boolean;
  convertToEasternTime: (utcTimestamp: string) => string;
  onSelectMessage?: (message: Message) => void;
  createMessagePreview?: (message: Message) => string;
}

// Component for message preview - supports both standard text and structured metrics display
const StaticPreview: React.FC<{ 
  content: string | { metrics: Array<{label: string, value: string, expected: string}> }; 
  multiline?: boolean;
  isMetrics?: boolean;
}> = ({ content, multiline = false, isMetrics = false }) => {
  // If it's metrics data, render a structured layout
  if (isMetrics && typeof content !== 'string') {
    return (
      <div 
        style={{
          backgroundColor: '#f0f9ff', // Light blue background
          border: '1px solid #bfdbfe', // Light blue border
          borderRadius: '4px',
          padding: '8px 12px',
          margin: '4px 0',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Only render if we have at least one populated metric */}
          {content.metrics.some(metric => metric.value !== 'N/A' && metric.expected !== 'N/A') ? (
            <>
              {/* Current Quarter Section */}
              <div style={{ fontWeight: '600', color: '#2563eb', fontSize: '0.875rem' }}>Current Quarter:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {content.metrics.slice(0, 2)
                  .filter(metric => metric.value !== 'N/A' && metric.expected !== 'N/A') // Only show populated metrics
                  .map((metric, index) => (
                    <div key={index} style={{ 
                      flex: '1 1 calc(50% - 4px)', 
                      minWidth: '120px',
                      backgroundColor: '#e0f2fe',
                      padding: '4px 8px',
                      borderRadius: '4px'
                    }}>
                      <div style={{ fontWeight: '500', fontSize: '0.75rem', color: '#64748b' }}>{metric.label}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontWeight: '600', color: '#1e40af' }}>{metric.value}</span>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>vs</span>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{metric.expected}</span>
                      </div>
                    </div>
                  ))
                }
              </div>
              
              {/* Next Quarter Section - Only show if there are populated metrics */}
              {content.metrics.slice(2, 4).some(metric => metric.value !== 'N/A' && metric.expected !== 'N/A') && (
                <>
                  <div style={{ fontWeight: '600', color: '#2563eb', fontSize: '0.875rem', marginTop: '4px' }}>Next Quarter:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {content.metrics.slice(2, 4)
                      .filter(metric => metric.value !== 'N/A' && metric.expected !== 'N/A') // Only show populated metrics
                      .map((metric, index) => (
                        <div key={index} style={{ 
                          flex: '1 1 calc(50% - 4px)', 
                          minWidth: '120px',
                          backgroundColor: '#e0f2fe',
                          padding: '4px 8px',
                          borderRadius: '4px'
                        }}>
                          <div style={{ fontWeight: '500', fontSize: '0.75rem', color: '#64748b' }}>{metric.label}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: '600', color: '#1e40af' }}>{metric.value}</span>
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>vs</span>
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{metric.expected}</span>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ padding: '8px', color: '#64748b', fontSize: '0.875rem', textAlign: 'center' }}>
              No metrics available
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Standard text preview
  return (
    <div 
      style={{
        backgroundColor: '#f0f9ff', // Light blue background
        border: '1px solid #bfdbfe', // Light blue border
        borderRadius: '4px',
        padding: '8px 12px',
        margin: '4px 0',
        minHeight: '30px', // Minimum height
        maxHeight: multiline ? '120px' : '30px', // Allow more height for multiline
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-start' // Align to top for multiline
      }}
    >
      <div
        style={{
          color: '#1e40af', // Darker blue text
          fontWeight: '500',
          fontSize: '0.875rem',
          lineHeight: '1.4',
          width: '100%',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap', // Allow wrapping for multiline
          overflow: 'hidden',
          textOverflow: multiline ? 'clip' : 'ellipsis' // Add ellipsis for single line only
        }}
      >
        {typeof content === 'string' ? content : ''}
      </div>
    </div>
  );
};

const MessagesList: React.FC<MessagesListProps> = ({
  messages = [],
  loading,
  convertToEasternTime,
  onSelectMessage,
  createMessagePreview: externalCreateMessagePreview
}) => {
  // State to track new messages for highlighting
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  // State to track search term
  const [searchMessageTicker, setSearchMessageTicker] = useState<string>('');
  // State to hold deduplicated messages
  const [deduplicatedMessages, setDeduplicatedMessages] = useState<Message[]>([]);
  
  // Refs
  const allSeenMessageIdsRef = useRef<Set<string>>(new Set());
  const prevMessagesRef = useRef<Message[]>([]);
  const initialLoadCompletedRef = useRef<boolean>(false);
  
  // Update search term from props
  useEffect(() => {
    // Extract search term from WebSocketStatus component
    const searchParam = new URLSearchParams(window.location.search).get('search');
    if (searchParam) {
      setSearchMessageTicker(searchParam);
    }
  }, []);
  
  // Process and deduplicate messages
  useEffect(() => {
    if (!messages || messages.length === 0) {
      setDeduplicatedMessages([]);
      return;
    }

    // Create a map to track the first message for each ticker
    const tickerMessageMap = new Map<string, Message>();
    
    // Sort messages by timestamp (newest first) before deduplication
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    // Process messages to keep only the first one per ticker
    sortedMessages.forEach(message => {
      // For each ticker, we want to keep at most 2 messages:
      // 1. One with a link (typically the first announcement)
      // 2. One with processed data from the report
      
      const key = message.ticker;
      const existingMessage = tickerMessageMap.get(key);
      
      // If we don't have a message for this ticker yet, add it
      if (!existingMessage) {
        tickerMessageMap.set(key, message);
      } 
      // If we already have a message for this ticker
      else {
        // If current message has a link and existing doesn't, or vice versa, keep both
        const hasLink = !!message.link;
        const existingHasLink = !!existingMessage.link;
        
        // If they have different link status (one has link, other doesn't), 
        // we want to keep both as they serve different purposes
        if (hasLink !== existingHasLink) {
          // Store as a special key to keep both messages
          tickerMessageMap.set(`${key}-${hasLink ? 'link' : 'data'}`, message);
        }
        // If both have the same link status, keep the newer one (which should be first in our sorted array)
        // This is already handled by the initial set operation
      }
    });
    
    // Convert the map values back to an array and sort by timestamp
    const deduplicated = Array.from(tickerMessageMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    setDeduplicatedMessages(deduplicated);
  }, [messages]);
  // Helper function to create a preview of the message content
  const createMessagePreview = (message: Message): { 
    content: string | { metrics: Array<{label: string, value: string, expected: string}> }; 
    multiline: boolean;
    isMetrics: boolean;
  } => {
    // Use external preview function if provided
    if (externalCreateMessagePreview) {
      return { content: externalCreateMessagePreview(message), multiline: false, isMetrics: false };
    }
    
    // If EPSComparison is available, use that for the preview
    if (message.EPSComparison) {
      return { content: message.EPSComparison, multiline: false, isMetrics: false };
    }
    
    // Otherwise fall back to discord_message
    if (!message.discord_message) return { content: '', multiline: false, isMetrics: false };
    
    // Check if discord_message is a JSON string
    try {
      // Try to parse as JSON
      const jsonData = JSON.parse(message.discord_message);
      
      // Check if it has the specific earnings data format we're looking for
      if (jsonData.current_quarter_vs_expected && jsonData.next_quarter_vs_expected) {
        // Extract the metrics data
        const currentSales = jsonData.current_quarter_vs_expected.sales || {};
        const currentEPS = jsonData.current_quarter_vs_expected.eps || {};
        const nextSales = jsonData.next_quarter_vs_expected.sales || {};
        const nextEPS = jsonData.next_quarter_vs_expected.eps || {};
        
        // Format the data as structured metrics
        const metricsData = {
          metrics: [
            {
              label: 'Sales',
              value: currentSales.actual || 'N/A',
              expected: currentSales.expected || 'N/A'
            },
            {
              label: 'EPS',
              value: currentEPS.actual || 'N/A',
              expected: currentEPS.expected || 'N/A'
            },
            {
              label: 'Sales',
              value: nextSales.guidance || 'N/A',
              expected: nextSales.expected || 'N/A'
            },
            {
              label: 'EPS',
              value: nextEPS.guidance || 'N/A',
              expected: nextEPS.expected || 'N/A'
            }
          ]
        };
        
        return { content: metricsData, multiline: true, isMetrics: true };
      }
      
      // If it has a message property but not the specific format, return just that part
      if (jsonData.message) {
        return { content: jsonData.message, multiline: false, isMetrics: false };
      }
    } catch {
      // Not JSON, continue with regular text processing
    }
    
    // Remove any markdown formatting
    const plainText = message.discord_message
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '')   // Remove italic
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`.*?`/g, '') // Remove inline code
      .replace(/\[.*?\]\(.*?\)/g, '') // Remove links
      .replace(/#/g, '') // Remove headings
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
      .trim();
    
    // For static preview, we want to show as much content as possible
    return { content: plainText, multiline: false, isMetrics: false };
  };

  // Set initial messages after first load
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialLoadCompletedRef.current) {
      // Set the initial messages as the baseline - these won't be highlighted
      prevMessagesRef.current = [...messages];
      
      // Add all initial message IDs to the seen set
      const initialMessageIds = new Set(messages.map(msg => msg.message_id));
      allSeenMessageIdsRef.current = initialMessageIds;
      
      initialLoadCompletedRef.current = true;
    }
  }, [loading, messages]);
  
  // Update search term from props
  useEffect(() => {
    // Extract search term from WebSocketStatus component
    const searchParam = new URLSearchParams(window.location.search).get('search');
    if (searchParam) {
      setSearchMessageTicker(searchParam);
    }
  }, []);

  // Detect new messages and highlight them for 1 minute
  useEffect(() => {
    // Skip this effect until initial load is completed
    if (!initialLoadCompletedRef.current || !messages || messages.length === 0) return;
    
    // Find truly new messages - ones we've never seen before in any state
    const genuinelyNewMessages = messages.filter(msg => !allSeenMessageIdsRef.current.has(msg.message_id));
    
    // Update our record of all seen message IDs
    messages.forEach(msg => {
      allSeenMessageIdsRef.current.add(msg.message_id);
    });
    
    // Get IDs of genuinely new messages
    const genuinelyNewMessageIds = genuinelyNewMessages.map(msg => msg.message_id);
    
    // If we have new messages, add them to the set and set a timer to remove them
    if (genuinelyNewMessageIds.length > 0) {
      setNewMessageIds(prev => {
        const updatedSet = new Set(prev);
        genuinelyNewMessageIds.forEach(id => updatedSet.add(id));
        return updatedSet;
      });
      
      // For each new message, set a timeout to remove the highlight after 1 minute
      genuinelyNewMessageIds.forEach(id => {
        setTimeout(() => {
          setNewMessageIds(prev => {
            const updatedSet = new Set(prev);
            updatedSet.delete(id);
            return updatedSet;
          });
        }, 60000); // 1 minute = 60000 milliseconds
      });
    }
    
    // Update the previous messages ref
    prevMessagesRef.current = messages;
  }, [messages]);

  if (loading && (!messages || messages.length === 0)) {
    return (
      <div className="bg-white p-6 rounded-md shadow-md border border-neutral-100 text-center">
        <p className="text-neutral-500">Loading messages...</p>
      </div>
    );
  }

  if ((!deduplicatedMessages || deduplicatedMessages.length === 0)) {
    return (
      <div className="bg-white p-6 rounded-md shadow-md border border-neutral-100 text-center">
        <p className="text-neutral-500">
          {searchMessageTicker ? `No messages found for "${searchMessageTicker}"` : "No messages found"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[calc(100vh-120px)] overflow-auto scrollbar-hide">
      {deduplicatedMessages.map((message) => (
        <div 
          key={message.message_id}
          className={`bg-white p-3 rounded-md shadow-md hover:border-primary-200 transition-colors ${
            newMessageIds.has(message.message_id) 
              ? 'border-2 border-green-500' 
              : 'border border-neutral-100'
          }`}
        >
          {message.link ? (
            /* Link message - show on a single line like analysis messages */
            <a 
              href={message.link} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex justify-between items-center cursor-pointer hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-blue-600">{message.ticker}</span>
                <span className="text-xs text-neutral-600">Q{message.quarter}</span>
                <span className="text-xs text-neutral-500">
                  {convertToEasternTime(message.timestamp)}
                </span>
              </div>
              
              <div className="inline-flex items-center justify-center w-6 h-6 bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100 transition-colors">
                <ExternalLink size={14} />
              </div>
            </a>
          ) : (
            /* Analysis message with static preview */
            <div 
              className="flex flex-col cursor-pointer hover:bg-neutral-50 transition-colors"
              onClick={() => {
                if (onSelectMessage) {
                  onSelectMessage(message);
                }
              }}
            >
              {/* Header with ticker and timestamp */}
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center space-x-2">
                  {/* Removed redundant ticker display */}
                  <div className="flex items-center bg-primary-50 px-2 py-0.5 rounded-md text-xs">
                    <span className="font-medium text-primary-700">{message.ticker}</span>
                    <span className="mx-1 text-neutral-400">|</span>
                    <span className="text-neutral-600">Q{message.quarter}</span>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {convertToEasternTime(message.timestamp)}
                  </span>
                </div>
                
                <div className="inline-flex items-center justify-center w-6 h-6 bg-primary-50 text-primary-700 rounded-full hover:bg-primary-100 transition-colors">
                  <BarChart2 size={14} />
                </div>
              </div>
              
              {/* Static preview of the message content */}
              {message.discord_message && (
                <StaticPreview 
                  content={createMessagePreview(message).content} 
                  multiline={createMessagePreview(message).multiline}
                  isMetrics={createMessagePreview(message).isMetrics}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default MessagesList;
