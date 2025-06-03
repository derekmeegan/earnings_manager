import React, { useEffect, useState, useRef } from 'react';
import { Message, MetricItem } from '../../../types';
import { ExternalLink, BarChart2 } from 'lucide-react';
import { ParseMessagePayload } from '../utils/messageUtils';

interface MessagesListProps {
  messages: Message[];
  loading: boolean;
  isMobile?: boolean;
  convertToEasternTime: (utcTimestamp: string) => string;
  onSelectMessage?: (message: Message) => void;
}

const StaticPreview: React.FC<{ 
  content: { [key: string]: MetricItem[] } | null; 
  isMobile?: boolean;
  previewKey?: number;
}> = ({ content, isMobile = false, previewKey }) => {
  if (content) {
    return (
      <div key={previewKey}
      className={`
        bg-sky-50 border border-sky-200 rounded flex items-center w-full max-w-full box-border overflow-hidden my-[2px]
        ${isMobile
          ? 'py-[5px] px-[8px] min-h-6 max-h-[100px]'
          : 'py-[3px] px-[8px] min-h-[20px] max-h-[80px]'}
      `}
      >
        <div key={previewKey} className="flex flex-row flex-nowrap gap-2 items-center w-full overflow-hidden whitespace-nowrap">
          {content ? (
            <div key={previewKey} className="flex flex-col flex-nowrap gap-2 items-start">
              {Object.keys(content)
              .filter((key) => ['Current Quarter', 'Next Quarter', 'Historical Growth', 'Current Year'].includes(key))
              .slice(0, 3)
              .map((key, index) => (
                <div key={key+index} className="flex items-center gap-1 flex-shrink-0">
                  <div key={key+index} className="font-bold text-[0.7rem] text-blue-800">{key}:</div>
                  {content[key]
                  .map((metric: MetricItem, itemIndex: number) => (
                    <>
                    {metric.text && <div key={key+itemIndex} className="font-medium text-[0.7rem] text-blue-800">{metric.text}</div>}
                    </>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div key={previewKey} className="text-blue-800 font-medium text-[0.7rem] text-center">No metrics available</div>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div key={previewKey}
      className={`bg-sky-50 border border-sky-200 rounded flex items-center w-full max-w-full box-border overflow-hidden my-[2px]
      ${isMobile
        ? 'py-[5px] px-[8px] min-h-6 max-h-[100px]'
        : 'py-[3px] px-[8px] min-h-[20px] max-h-[80px]'}`}
    >
      <div key={previewKey} className={`
          text-blue-800 font-medium w-full overflow-hidden leading-[1.4]
          ${isMobile
            ? 'text-[0.8rem] whitespace-pre-wrap text-clip break-words'
            : 'text-[0.7rem] whitespace-nowrap truncate break-normal'}
        `}
      >
        {typeof content === 'string' ? content : ''}
      </div>
    </div>
  );
};

const MessagesList: React.FC<MessagesListProps> = ({
  messages = [],
  loading,
  isMobile,
  convertToEasternTime,
  onSelectMessage,
}) => {

  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  const [searchMessageTicker, setSearchMessageTicker] = useState<string>('');
  const [deduplicatedMessages, setDeduplicatedMessages] = useState<Message[]>([]);
  
  const allSeenMessageIdsRef = useRef<Set<string>>(new Set());
  const prevMessagesRef = useRef<Message[]>([]);
  const initialLoadCompletedRef = useRef<boolean>(false);
  
  useEffect(() => {
    const searchParam = new URLSearchParams(window.location.search).get('search');
    if (searchParam) {
      setSearchMessageTicker(searchParam);
    }
  }, []);
  
  useEffect(() => {
    if (!messages || messages.length === 0) {
      setDeduplicatedMessages([]);
      return;
    }

    // Create separate maps for link and analysis messages
    const linkMessagesMap = new Map<string, Message>();
    const analysisMessagesMap = new Map<string, Message>();
    
    // Sort messages by timestamp (oldest first) to prioritize speed
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    sortedMessages.forEach(message => {
      const key = message.ticker + message.quarter + message.year;
      const hasLink = !!message.link;
      
      if (hasLink) {
        // This is a link message
        if (!linkMessagesMap.has(key)) {
          linkMessagesMap.set(key, message);
        }
      } else {
        // This is an analysis message
        if (!analysisMessagesMap.has(key)) {
          analysisMessagesMap.set(key, message);
        }
      }
    });
    
    // Combine both types of messages
    const combinedMessages = [
      ...Array.from(linkMessagesMap.values()),
      ...Array.from(analysisMessagesMap.values())
    ];
    
    // Sort final results by timestamp (newest first for display)
    const deduplicated = combinedMessages.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    setDeduplicatedMessages(deduplicated);
  }, [messages]);

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
    <div 
      className="max-h-[calc(100vh-120px)] overflow-auto scrollbar-hide"
      style={{
        width: '100%',
        maxWidth: '100%',
        overflowX: 'hidden'
      }}
    >
      {deduplicatedMessages.map((message, index) => (
        <div 
          key={message.message_id}
          className={`bg-white py-2 px-2 border-b transition-colors hover:bg-neutral-50 ${
            newMessageIds.has(message.message_id) 
              ? 'border-l-4 border-l-green-500' 
              : ''
            } ${!message.link ? 'cursor-pointer' : ''}`}
          onClick={() => onSelectMessage && onSelectMessage(message)}
          style={{
            padding: isMobile ? '10px 8px' : undefined,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflowX: 'hidden',
          }}
        >
          {message.link ? (
            /* Link message - show on a single line like analysis messages */
            <div
              className="flex justify-between items-center cursor-pointer transition-colors"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: '0',
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <div
                className="flex items-center"
                style={{
                  flexWrap: 'nowrap',
                  gap: '4px',
                  width: isMobile ? 'calc(100% - 30px)' : undefined,
                  maxWidth: '100%',
                  overflow: 'hidden',
                }}
              >
                {/* Ticker and company name */}
                <div 
                  className="flex items-center space-x-1 px-1.5 py-0.5 text-xs"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: '2px 6px',
                    width: 'auto',
                    maxWidth: isMobile ? 'calc(100% - 30px)' : '100%',
                    boxSizing: 'border-box',
                    overflowX: 'hidden'
                  }}
                >
                  <span 
                    className="font-medium text-neutral-800"
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {message.ticker}
                  </span>
                  
                  {message.company_name && (
                    <span
                      className="text-neutral-500"
                      style={{
                        maxWidth: isMobile ? '60px' : '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {message.company_name}
                    </span>
                  )}
                  
                  <span className="text-neutral-600 mx-1">
                    Q{message.quarter}
                  </span>
                </div>
                
                <span className="text-xs text-neutral-500 ml-1">
                  {convertToEasternTime(message.timestamp)}
                </span>
              </div>
              <div
                className="inline-flex items-center justify-center w-5 h-5 bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100 transition-colors"
                style={{
                  alignSelf: undefined,
                  marginTop: '0',
                  marginLeft: '4px',
                }}
              >
                <a href={message.link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          ) : (
            /* Analysis message with static preview */
            <div
              className="flex flex-col transition-colors"
              style={{
                gap: isMobile ? '8px' : undefined,
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <div
                className="flex justify-between items-center mb-1"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: undefined,
                  marginBottom: '4px',
                  width: '100%',
                  maxWidth: '100%',
                  overflow: 'hidden'
                }}
              >
                <div
                  className="flex items-center"
                  style={{
                    flexWrap: 'nowrap',
                    gap: '4px',
                    width: isMobile ? 'calc(100% - 30px)' : undefined,
                    maxWidth: '100%',
                    overflow: 'hidden',
                  }}
                >
                  {/* Ticker and company name */}
                  <div 
                    className="flex items-center space-x-1 px-1.5 py-0.5 text-xs"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: '2px 6px',
                      width: 'auto',
                      maxWidth: isMobile ? 'calc(100% - 30px)' : '100%',
                      boxSizing: 'border-box',
                      overflowX: 'hidden'
                    }}
                  >
                    <span 
                      className="font-bold text-neutral-800"
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {message.ticker}
                    </span>

                    {message.company_name && (
                      <span 
                        className="text-neutral-500"
                        style={{
                          maxWidth: isMobile ? '60px' : '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {message.company_name}
                      </span>
                    )}

                    <span className="text-neutral-600 mx-1">
                      Q{message.quarter}
                    </span>
                  </div>

                  <span className="text-xs text-neutral-500 ml-1">
                    {convertToEasternTime(message.timestamp)}
                  </span>
                  <div
                    className="inline-flex items-center justify-center w-5 h-5 bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100 transition-colors"
                    style={{
                      alignSelf: undefined,
                      marginTop: '0',
                      marginLeft: '4px',
                    }}
                  >
                    <BarChart2 size={14} />
                  </div>
                </div>
              </div>

              {/* Static preview of the message content */}
              {message.discord_message && (
                <StaticPreview
                  content={ParseMessagePayload(message)}
                  isMobile={isMobile}
                  previewKey={index}
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
