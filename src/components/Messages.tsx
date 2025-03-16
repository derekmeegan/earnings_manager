import React, { useState, useEffect, useCallback } from 'react';
import { 
  getMessages,
  getEarningsItems, 
  updateEarningsItem, 
  getHistoricalMetricsByTickerAndDate,
  updateHistoricalMetrics,
  createHistoricalMetrics,
  getCompanyConfigs, // <--- Added this line
  getCompanyConfigByTicker,
  createOrUpdateCompanyConfig
} from '../services/api';
import { Message, EarningsItem, HistoricalMetrics, CompanyConfig } from '../types';
import { useForm, SubmitHandler } from 'react-hook-form';
import { toast } from 'react-toastify';
import { 
  CalendarIcon, ChevronDown, ChevronUp, Loader, PieChart, BarChart, 
  Search, Plus, WifiOff, Wifi, RefreshCw, Settings 
} from 'lucide-react';
import { format } from 'date-fns';
import { useWebSocket } from '../hooks/useWebSocket';

const Messages: React.FC = () => {
  const [earningsItems, setEarningsItems] = useState<EarningsItem[]>([]);
  const [filteredEarningsItems, setFilteredEarningsItems] = useState<EarningsItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [searchTicker, setSearchTicker] = useState('');
  const [filterActive, setFilterActive] = useState<boolean | null>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showModal, setShowModal] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [currentItem, setCurrentItem] = useState<EarningsItem | null>(null);
  const [currentConfigItem, setCurrentConfigItem] = useState<EarningsItem | null>(null);
  const [metricsMap, setMetricsMap] = useState<Record<string, boolean>>({});
  const [configMap, setConfigMap] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [searchMessageTicker, setSearchMessageTicker] = useState('');

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<EarningsItem>();
  const { 
    register: registerMetrics, 
    handleSubmit: handleSubmitMetrics, 
    reset: resetMetrics,
    formState: { errors: metricsErrors } 
  } = useForm<HistoricalMetrics>();
  const { 
    register: registerConfig, 
    handleSubmit: handleSubmitConfig, 
    reset: resetConfig,
    formState: { errors: configErrors } 
  } = useForm<CompanyConfig>({
    defaultValues: {
      ticker: '',
      base_url: '',
      extraction_method: 'javascript',
      href_ignore_words: [],
      llm_instructions: {
        system: '',
        temperature: 0
      },
      selector: '',
      url_ignore_list: [],
      verify_keywords: {
        fixed_terms: [],
        quarter_as_string: false,
        quarter_with_q: false,
        requires_current_year: false,
        requires_quarter: false,
        requires_year: false
      },
      browser_type: 'chromium',
      page_content_selector: 'body'
    }
  });

  // Handle new WebSocket messages
  const handleNewMessage = useCallback((newMessage: Message) => {
    console.log('New message received via WebSocket:', newMessage);
    
    setMessages(prevMessages => {
      // Check if the message already exists by ID
      const exists = prevMessages.some(msg => msg.message_id === newMessage.message_id);
      if (exists) {
        console.log('Message already exists, not adding duplicate');
        return prevMessages;
      }
      
      // Add the new message and sort by timestamp (newest first)
      const updatedMessages = [...prevMessages, newMessage]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return updatedMessages;
    });
    
    // Show a toast notification for the new message
    toast.info(`New message received for ${newMessage.ticker}`);
    
    // Initialize as not expanded
    setExpandedMessages(prev => ({
      ...prev,
      [newMessage.message_id]: prev[newMessage.message_id] || false
    }));
  }, []);

  // Handle WebSocket connection changes
  const handleConnectionChange = useCallback((connected: boolean) => {
    // Remove the toast notification to prevent multiple notifications
    // if (connected) {
    //   toast.success('Real-time connection established');
    // }
  }, []);

  // Use the WebSocket hook
  const { 
    connected, 
    reconnecting, 
    enabled,
    enable: enableWebSocket,
    disable: disableWebSocket
  } = useWebSocket({
    onMessage: handleNewMessage,
    onConnectionChange: handleConnectionChange,
    persistConnection: true // Keep connection alive when component unmounts
  });

  // Function to convert UTC to Eastern Time (EST/EDT) with automatic daylight savings time handling
  const convertToEasternTime = (utcTimestamp: string): string => {
    // Create a date object from the UTC timestamp
    const date = new Date(utcTimestamp);
    
    // Format the date to Eastern Time (automatically handles EST/EDT transitions)
    // The America/New_York timezone will automatically adjust for daylight savings time
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  // Function to format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Function to create a preview of the message content
  const createMessagePreview = (content: string, maxLength: number = 150): string => {
    if (!content) return '';
    
    // Remove any markdown symbols that might make the preview look odd
    const cleanContent = content.replace(/[#*_~`]/g, '');
    
    if (cleanContent.length <= maxLength) return cleanContent;
    
    // Find the last space before maxLength to avoid cutting words
    const lastSpaceIndex = cleanContent.substring(0, maxLength).lastIndexOf(' ');
    const cutoffIndex = lastSpaceIndex > 0 ? lastSpaceIndex : maxLength;
    
    return cleanContent.substring(0, cutoffIndex) + '...';
  };

  // Check if metrics exist for a ticker and date
  const checkMetricsExist = useCallback(async (ticker: string, date: string) => {
    if (!ticker || !date) return false;
    
    try {
      const metrics = await getHistoricalMetricsByTickerAndDate(ticker, date);
      const hasMetrics = metrics !== null && Object.keys(metrics).length > 0;
      return hasMetrics;
    } catch (error) {
      console.error('Error checking metrics:', error);
      // Don't fail - just assume no metrics exist
      return false;
    }
  }, []);

  // Fetch metrics status for all active items
  const fetchMetricsStatus = useCallback(async (items: EarningsItem[]) => {
    const metricsStatusMap: Record<string, boolean> = {};
    
    for (const item of items) {
      if (item.is_active) {
        const key = `${item.ticker}-${item.date}`;
        metricsStatusMap[key] = await checkMetricsExist(item.ticker, item.date);
      }
    }
    
    setMetricsMap(metricsStatusMap);
  }, [checkMetricsExist]);

  // Cache storage
  const configCache = React.useRef({
    lastFetch: 0,
    data: {} as Record<string, boolean>
  });

  // Fetch configuration status for each ticker
  const fetchConfigStatus = useCallback(async () => {
    const now = Date.now();
    
    // Only refetch if it's been at least 30 seconds since the last fetch
    // and we already have some cached data
    if (now - configCache.current.lastFetch < 30000 && 
        Object.keys(configCache.current.data).length > 0) {
      console.log('Using cached config status');
      setConfigMap(configCache.current.data);
      return;
    }
    
    try {
      // Get all configs at once instead of individually
      const allConfigs = await getCompanyConfigs();
      const configsMap = allConfigs.reduce((map: Record<string, boolean>, config) => {
        map[config.ticker] = true;
        return map;
      }, {});
      
      // Update cache
      configCache.current = {
        lastFetch: now,
        data: configsMap
      };
      
      // Set config map
      setConfigMap(configsMap);
    } catch (error) {
      console.error('Error fetching configs:', error);
    }
  }, []);

  const fetchMessages = async (bypassCache: boolean = false) => {
    try {
      if (!messages.length) {
        // Only show full page loading on initial load
        setLoading(true);
      } else if (bypassCache) {
        // Show refreshing indicator for subsequent loads
        setRefreshing(true);
      }
      
      const fetchedMessages = await getMessages(bypassCache);
      
      // Sort messages by timestamp (newest first)
      const sortedMessages = fetchedMessages.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      setMessages(sortedMessages);
      
      // Set all messages to be collapsed by default
      const expandedState: Record<string, boolean> = {};
      sortedMessages.forEach(message => {
        // Preserve expanded state for existing messages
        if (messages.some(m => m.message_id === message.message_id)) {
          // @ts-ignore
          expandedState[message.message_id] = expandedMessages[message.message_id] || false;
        } else {
          expandedState[message.message_id] = false;
        }
      });
      setExpandedMessages(expandedState);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast.error('Failed to fetch messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchEarningsItems = async () => {
    setLoading(true);
    try {
      const items = await getEarningsItems();
      setEarningsItems(items);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching earnings items:', error);
      toast.error('Failed to fetch earnings items');
      setLoading(false);
    }
  };

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    fetchMessages(true); // Bypass cache to get fresh data
    fetchEarningsItems();
  }, []);

  const handleRefreshWithToast = () => {
    handleRefresh();
    toast.info('Feed refreshed');
  };

  // Handle toggling active status for an earnings item
  const handleToggleActive = async (item: EarningsItem) => {
    try {
      const updatedItem = { ...item, is_active: !item.is_active };
      await updateEarningsItem(updatedItem);
      
      setEarningsItems(prev => 
        prev.map(i => 
          i.ticker === item.ticker && i.date === item.date ? updatedItem : i
        )
      );
      
      toast.success(`${item.ticker} is now ${!item.is_active ? 'active' : 'inactive'}`);
    } catch (error) {
      console.error('Failed to update item:', error);
      toast.error('Failed to update item');
    }
  };

  // Handle form submission for adding new item
  const onSubmit = async (data: EarningsItem) => {
    try {
      // Format the date to YYYY-MM-DD
      const formattedDate = format(new Date(data.date), 'yyyy-MM-dd');
      const newItem = {
        ...data,
        date: formattedDate,
        is_active: data.is_active || false,
      };
      
      await createEarningsItem(newItem);
      setEarningsItems(prev => [...prev, newItem]);
      setShowModal(false);
      reset();
      toast.success(`Added ${newItem.ticker} for ${formattedDate}`);
    } catch (error) {
      console.error('Failed to add item:', error);
      toast.error('Failed to add item');
    }
  };

  // Handle metrics form submission
  const onMetricsSubmit: SubmitHandler<HistoricalMetrics> = async (data) => {
    if (!currentItem) return;

    try {
      // Add ticker and date to the metrics object
      const metricsData = {
        ...data,
        ticker: currentItem.ticker,
        date: currentItem.date
      };

      // Check if metrics exist
      const existingMetrics = await getHistoricalMetricsByTickerAndDate(currentItem.ticker, currentItem.date);
      
      if (existingMetrics && Object.keys(existingMetrics).length > 0) {
        // Update existing metrics
        await updateHistoricalMetrics(metricsData);
        toast.success(`Updated metrics for ${currentItem.ticker}`);
      } else {
        // Create new metrics
        await createHistoricalMetrics(metricsData);
        toast.success(`Added metrics for ${currentItem.ticker}`);
      }

      // Update metrics map
      setMetricsMap(prev => ({
        ...prev,
        [`${currentItem.ticker}-${currentItem.date}`]: true
      }));

      // Close modal
      setShowMetricsModal(false);
    } catch (error) {
      console.error('Error submitting metrics:', error);
      toast.error('Failed to save metrics');
    }
  };

  // Handle configuration form submission
  const onConfigSubmit: SubmitHandler<CompanyConfig> = async (data) => {
    if (!currentConfigItem) return;

    try {
      // Encode the system prompt to base64 if it exists
      let configData = {
        ...data,
        ticker: currentConfigItem.ticker
      };
      
      // Base64 encode the system prompt if it exists
      if (configData.llm_instructions?.system) {
        configData = {
          ...configData,
          llm_instructions: {
            ...configData.llm_instructions,
            system: btoa(configData.llm_instructions.system)
          }
        };
      }
      
      // Clean up arrays to remove empty values
      configData = {
        ...configData,
        href_ignore_words: configData.href_ignore_words?.filter(word => word !== '') || [],
        url_ignore_list: configData.url_ignore_list?.filter(url => url !== '') || [],
        verify_keywords: {
          ...configData.verify_keywords,
          fixed_terms: configData.verify_keywords?.fixed_terms?.filter(term => term !== '') || []
        }
      };
      
      // Create or update company config
      await createOrUpdateCompanyConfig(configData);
      
      // Update config map directly
      const newConfigMap = {
        ...configMap,
        [currentConfigItem.ticker]: true
      };
      
      // Update both state and cache
      setConfigMap(newConfigMap);
      configCache.current = {
        lastFetch: Date.now(),
        data: newConfigMap
      };
      
      toast.success(`Configuration for ${currentConfigItem.ticker} saved successfully`);
      
      // Close modal
      setShowConfigModal(false);
    } catch (error) {
      console.error('Error submitting configuration:', error);
      toast.error('Failed to save configuration');
    }
  };

  // Handle opening metrics modal
  const handleOpenMetricsModal = async (item: EarningsItem) => {
    setCurrentItem(item);
    setShowMetricsModal(true);
    
    // Check if metrics exist for this ticker and date
    try {
      const existingMetrics = await getHistoricalMetricsByTickerAndDate(item.ticker, item.date);
      
      // If metrics exist and are not empty, pre-populate the form
      if (existingMetrics && Object.keys(existingMetrics).length > 0) {
        resetMetrics(existingMetrics);
      } else {
        resetMetrics(); // Reset form if no metrics exist
      }
    } catch (error) {
      console.error('Error fetching metrics for item:', error);
      // In case of error, just show an empty form
      resetMetrics();
      toast.error('Could not fetch existing metrics. Starting with an empty form.');
    }
  };

  // Handle opening config modal
  const handleOpenConfigModal = async (item: EarningsItem) => {
    setCurrentConfigItem(item);
    setShowConfigModal(true);
    
    const defaultConfig: CompanyConfig = {
      ticker: item.ticker,
      base_url: '',
      extraction_method: 'javascript',
      href_ignore_words: [],
      llm_instructions: {
        system: '',
        temperature: 0
      },
      selector: '',
      url_ignore_list: [],
      verify_keywords: {
        fixed_terms: [],
        quarter_as_string: false,
        quarter_with_q: false,
        requires_current_year: false,
        requires_quarter: false,
        requires_year: false
      },
      browser_type: 'chromium',
      page_content_selector: 'body'
    };
    
    // Check if config exists for this ticker
    try {
      const existingConfig = await getCompanyConfigByTicker(item.ticker);
      
      // If config exists, pre-populate the form
      if (existingConfig) {
        resetConfig(existingConfig);
      } else {
        // Reset form with default values
        resetConfig(defaultConfig);
      }
    } catch (error) {
      console.error('Error fetching config for item:', error);
      // In case of error, just show an empty form
      resetConfig(defaultConfig);
      toast.error('Could not fetch existing configuration. Starting with a new form.');
    }
  };

  // Filter items based on search term, date and active status
  const applyFilters = () => {
    // Apply filters to earnings items
    setFilteredEarningsItems(earningsItems.filter(item => {
      const matchesDate = item.date === selectedDate;
      const matchesSearch = searchTicker === '' || item.ticker.toLowerCase().includes(searchTicker.toLowerCase());
      const matchesActive = filterActive === null || item.is_active === filterActive;
      
      return matchesDate && matchesSearch && matchesActive;
    }));

    // Apply ticker filter to messages
    setMessages(prevMessages => 
      prevMessages.filter(message => 
        searchMessageTicker === '' || message.ticker.toLowerCase().includes(searchMessageTicker.toLowerCase())
      )
    );
  };

  useEffect(() => {
    fetchEarningsItems();
    fetchMessages();
    fetchConfigStatus();
  }, []); // Remove fetchConfigStatus from dependencies

  useEffect(() => {
    if (earningsItems.length > 0) {
      applyFilters();
      fetchMetricsStatus(earningsItems);
    }
  }, [earningsItems, searchTicker, filterActive, selectedDate, fetchMetricsStatus]);

  // Function to toggle expanded state of a message
  const toggleExpand = (messageId: string) => {
    setExpandedMessages(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  // Function to check if a message is expanded
  const isExpanded = (messageId: string): boolean => {
    return Boolean(expandedMessages[messageId]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-120px)]">
        {/* Left side - Companies list - 3/4 of the page */}
        <div className="w-full md:w-3/4 bg-white p-6 rounded-md shadow-md border border-neutral-100 flex flex-col overflow-hidden">
          {/* Fixed input controls */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-end gap-3 w-full sm:w-2/3">
              {/* Search box */}
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Search size={14} className="text-neutral-400" />
                  </div>
                  <input
                    type="text"
                    id="ticker-search"
                    placeholder="Search ticker..."
                    value={searchTicker}
                    onChange={(e) => setSearchTicker(e.target.value)}
                    className="pl-8 block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-xs h-8"
                  />
                </div>
              </div>
              
              {/* Date selector */}
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <CalendarIcon size={14} className="text-neutral-400" />
                  </div>
                  <input
                    type="date"
                    id="date-selector"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="pl-8 block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-xs h-8"
                  />
                </div>
              </div>
              
              {/* Show filters */}
              <div className="flex-1">
                <div className="flex space-x-1 h-8">
                  <button
                    onClick={() => setFilterActive(null)}
                    className={`px-2 py-1 text-xs rounded-md ${
                      filterActive === null 
                        ? 'bg-neutral-600 text-white' 
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    } transition-colors duration-150 ease-in-out flex-1`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterActive(true)}
                    className={`px-2 py-1 text-xs rounded-md ${
                      filterActive === true 
                        ? 'bg-success-500 text-white' 
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    } transition-colors duration-150 ease-in-out flex-1`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => setFilterActive(false)}
                    className={`px-2 py-1 text-xs rounded-md ${
                      filterActive === false 
                        ? 'bg-error-500 text-white' 
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    } transition-colors duration-150 ease-in-out flex-1`}
                  >
                    Inactive
                  </button>
                </div>
              </div>
            </div>
            
            {/* Add Item Button (just a plus icon) */}
            <div className="flex items-center">
              <button
                onClick={() => setShowModal(true)}
                className="p-1.5 h-8 w-8 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors duration-150 ease-in-out shadow-sm flex items-center justify-center"
                aria-label="Add Item"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          
          {/* Scrollable content */}
          <div className="flex-grow overflow-y-auto scrollbar-hide">
            {loading ? (
              <div className="text-center py-8">
                <Loader size={24} className="animate-spin mx-auto mb-2" />
                <p className="text-neutral-500">Loading companies...</p>
              </div>
            ) : filteredEarningsItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-neutral-500">No companies found for the selected date.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                {filteredEarningsItems.map((item) => (
                  <div 
                    key={`${item.ticker}-${item.date}`} 
                    className="bg-white border border-neutral-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 aspect-square p-4 flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-xl font-semibold text-neutral-800">{item.ticker}</h3>
                      <div className="flex items-center space-x-2">
                        {item.is_active && (
                          <button
                            onClick={() => handleOpenMetricsModal(item)}
                            className={`p-1.5 rounded-full ${
                              metricsMap[`${item.ticker}-${item.date}`] 
                                ? 'bg-green-500 text-white hover:bg-green-600' 
                                : 'bg-neutral-100 text-neutral-400 hover:bg-neutral-200'
                            }`}
                            title={metricsMap[`${item.ticker}-${item.date}`] ? "Edit Metrics" : "Add Metrics"}
                          >
                            <BarChart size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenConfigModal(item)}
                          className={`p-1.5 rounded-full ${
                            configMap[item.ticker] 
                              ? 'bg-blue-500 text-white hover:bg-blue-600' 
                              : 'bg-neutral-100 text-neutral-400 hover:bg-neutral-200'
                          }`}
                          title={configMap[item.ticker] ? "Edit Config" : "Add Config"}
                        >
                          <Settings size={14} />
                        </button>
                        <div 
                          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                            item.is_active 
                              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' 
                              : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleActive(item);
                          }}
                        >
                          {item.is_active ? 'Active' : 'Inactive'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-sm text-neutral-500 mb-2">
                      <p>Q{item.quarter} {item.year}</p>
                      <p>{item.release_time === 'before' ? 'Before Market' : 
                         item.release_time === 'after' ? 'After Market' : 'During Market'}</p>
                    </div>
                    
                    {/* Placeholder for future chart */}
                    <div className="flex-grow bg-neutral-50 rounded-md border border-dashed border-neutral-200 flex items-center justify-center mt-2">
                      {metricsMap[`${item.ticker}-${item.date}`] ? (
                        <div className="flex flex-col items-center">
                          <PieChart size={24} className="text-primary-400 mb-1" />
                          <p className="text-neutral-600 text-xs font-medium">Metrics Available</p>
                          <p className="text-neutral-500 text-xs">Click chart button to view</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <p className="text-neutral-400 text-xs">No metrics added</p>
                          <p className="text-neutral-400 text-xs">Click chart button to add</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Right side - Messages - 1/4 of the page with scrollable content */}
        <div className="w-full md:w-1/4 flex flex-col">
          <div className="mb-3 flex items-center">
            {/* Message search box */}
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <Search size={14} className="text-neutral-400" />
              </div>
              <input
                type="text"
                placeholder="Search messages"
                value={searchMessageTicker}
                onChange={(e) => setSearchMessageTicker(e.target.value)}
                className="pl-8 pr-16 block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-xs h-8"
              />
              <div className="absolute inset-y-0 right-0 flex items-center space-x-1 pr-1">
                {refreshing && (
                  <div className="flex items-center text-primary-600">
                    <Loader size={14} className="animate-spin" />
                  </div>
                )}
                
                {/* Live button */}
                <button
                  onClick={() => {
                    if (enabled) {
                      disableWebSocket();
                      toast.info('Real-time updates disabled');
                    } else {
                      enableWebSocket();
                      // Force a connection attempt after enabling
                      setTimeout(() => {
                        if (enabled) {
                          // This will trigger a connection attempt if the WebSocket is enabled
                          fetchMessages(true);
                        }
                      }, 100);
                      toast.info('Real-time updates enabled');
                    }
                  }}
                  className={`flex items-center justify-center rounded-full w-6 h-6 transition-colors duration-150 ease-in-out ${
                    enabled 
                      ? connected 
                        ? 'bg-green-500 text-white hover:bg-green-600' 
                        : reconnecting 
                          ? 'bg-amber-500 text-white hover:bg-amber-600' 
                          : 'bg-neutral-300 text-white hover:bg-neutral-400'
                      : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
                  }`}
                  title={enabled ? "Disable real-time updates" : "Enable real-time updates"}
                >
                  {enabled ? (
                    connected ? (
                      <Wifi size={12} />
                    ) : (
                      reconnecting ? (
                        <Loader size={12} className="animate-spin" />
                      ) : (
                        <WifiOff size={12} />
                      )
                    )
                  ) : (
                    <WifiOff size={12} />
                  )}
                </button>
                
                {/* Refresh button */}
                <button
                  onClick={handleRefreshWithToast}
                  disabled={refreshing}
                  className={`flex items-center justify-center rounded-full w-6 h-6 bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition-colors duration-150 ease-in-out shadow-sm ${
                    refreshing ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  title="Refresh data"
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 scrollbar-hide" style={{ maxHeight: 'calc(100vh - 165px)' }}>
            {loading && messages.length === 0 ? (
              <div className="bg-white p-6 rounded-md shadow-md border border-neutral-100 text-center">
                <p className="text-neutral-500">Loading messages...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="bg-white p-6 rounded-md shadow-md border border-neutral-100 text-center">
                <p className="text-neutral-500">No messages found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                  .map((message) => (
                  <div 
                    key={message.message_id}
                    className="bg-white p-3 rounded-md shadow-md border border-neutral-100"
                  >
                    <div 
                      className="flex justify-between items-start cursor-pointer"
                      onClick={() => toggleExpand(message.message_id)}
                    >
                      <h3 className="text-sm font-medium text-neutral-800">
                        {message.ticker}
                      </h3>
                      <div className="flex items-center">
                        <div className="flex items-center bg-primary-50 px-2 py-0.5 rounded-md text-xs">
                          <span className="font-medium text-primary-700">{message.ticker}</span>
                          <span className="mx-1 text-neutral-400">|</span>
                          <span className="text-neutral-600">Q{message.quarter}</span>
                        </div>
                        <button
                          className="p-0.5 ml-1 text-neutral-500 hover:text-primary-600 transition-colors"
                          title={isExpanded(message.message_id) ? "Collapse" : "Expand"}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering the parent onClick
                            toggleExpand(message.message_id);
                          }}
                        >
                          {isExpanded(message.message_id) ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center text-xs text-neutral-500 mt-1 mb-1">
                      <span>{convertToEasternTime(message.timestamp)}</span>
                    </div>
                    
                    {!isExpanded(message.message_id) && (
                      <div className="text-neutral-600 whitespace-pre-wrap mt-1 text-xs">
                        {createMessagePreview(message.discord_message, 80)}
                      </div>
                    )}
                    
                    {isExpanded(message.message_id) && (
                      <div className="text-neutral-700 whitespace-pre-wrap markdown-content mt-1 text-xs">
                        {message.discord_message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Modal for adding new item */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className="bg-white p-6 rounded-md shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative z-50">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium text-neutral-800">Add Earnings Item</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-neutral-500 hover:text-neutral-700"
                >
                  &times;
                </button>
              </div>
              
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div>
                  <label htmlFor="ticker" className="block text-sm font-medium text-neutral-600 mb-1">
                    Ticker
                  </label>
                  <input
                    id="ticker"
                    type="text"
                    {...register('ticker', { required: 'Ticker is required' })}
                    className="block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    placeholder="AAPL"
                  />
                  {errors.ticker && (
                    <p className="mt-1 text-sm text-error-500">{errors.ticker.message}</p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="date" className="block text-sm font-medium text-neutral-600 mb-1">
                    Date
                  </label>
                  <Controller
                    control={control}
                    name="date"
                    rules={{ required: 'Date is required' }}
                    render={({ field }) => (
                      <DatePicker
                        selected={field.value ? new Date(field.value) : null}
                        onChange={(date) => field.onChange(date)}
                        className="block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                        dateFormat="yyyy-MM-dd"
                      />
                    )}
                  />
                  {errors.date && (
                    <p className="mt-1 text-sm text-error-500">{errors.date.message}</p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="year" className="block text-sm font-medium text-neutral-600 mb-1">
                      Year
                    </label>
                    <input
                      id="year"
                      type="number"
                      {...register('year', { 
                        required: 'Year is required',
                        valueAsNumber: true,
                        min: { value: 2000, message: 'Year must be 2000 or later' },
                        max: { value: 2100, message: 'Year must be 2100 or earlier' }
                      })}
                      className="block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    />
                    {errors.year && (
                      <p className="mt-1 text-sm text-error-500">{errors.year.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <label htmlFor="quarter" className="block text-sm font-medium text-neutral-600 mb-1">
                      Quarter
                    </label>
                    <select
                      id="quarter"
                      {...register('quarter', { 
                        required: 'Quarter is required',
                        valueAsNumber: true
                      })}
                      className="block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    >
                      <option value={1}>Q1</option>
                      <option value={2}>Q2</option>
                      <option value={3}>Q3</option>
                      <option value={4}>Q4</option>
                    </select>
                    {errors.quarter && (
                      <p className="mt-1 text-sm text-error-500">{errors.quarter.message}</p>
                    )}
                  </div>
                </div>
                
                <div>
                  <label htmlFor="release_time" className="block text-sm font-medium text-neutral-600 mb-1">
                    Release Time
                  </label>
                  <select
                    id="release_time"
                    {...register('release_time', { required: 'Release time is required' })}
                    className="block w-full rounded-md border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  >
                    <option value="before">Before Market</option>
                    <option value="after">After Market</option>
                    <option value="during">During Market</option>
                  </select>
                  {errors.release_time && (
                    <p className="mt-1 text-sm text-error-500">{errors.release_time.message}</p>
                  )}
                </div>
                
                <div className="flex items-center">
                  <input
                    id="is_active"
                    type="checkbox"
                    {...register('is_active')}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="is_active" className="ml-2 block text-sm text-gray-700">
                    Active
                  </label>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-md hover:bg-neutral-200 transition-colors duration-150 ease-in-out shadow-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors duration-150 ease-in-out shadow-sm"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal for adding metrics */}
      {showMetricsModal && currentItem && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowMetricsModal(false)}></div>
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto relative z-50">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-neutral-800">
                    {metricsMap[`${currentItem.ticker}-${currentItem.date}`] ? 'Edit' : 'Add'} Metrics for {currentItem.ticker}
                  </h2>
                  <button
                    onClick={() => setShowMetricsModal(false)}
                    className="text-neutral-500 hover:text-neutral-700"
                  >
                    &times;
                  </button>
                </div>
                
                <form onSubmit={handleSubmitMetrics(onMetricsSubmit)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Current Fiscal Year EPS Mean
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("current_fiscal_year_eps_mean", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.current_fiscal_year_eps_mean && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Current Fiscal Year Sales Mean (Millions)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("current_fiscal_year_sales_mean_millions", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.current_fiscal_year_sales_mean_millions && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Current Quarter EPS Mean
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("current_quarter_eps_mean", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.current_quarter_eps_mean && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Current Quarter Sales Estimate (Millions)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("current_quarter_sales_estimate_millions", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.current_quarter_sales_estimate_millions && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Next Quarter EPS Mean
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("next_quarter_eps_mean", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.next_quarter_eps_mean && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Next Quarter Sales Estimate (Millions)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...registerMetrics("next_quarter_sales_estimate_millions", { required: true })}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {metricsErrors.next_quarter_sales_estimate_millions && (
                      <p className="text-error-500 text-xs mt-1">This field is required</p>
                    )}
                  </div>
                  
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setShowMetricsModal(false)}
                      className="px-4 py-2 text-sm bg-neutral-100 text-neutral-700 rounded-md hover:bg-neutral-200 mr-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={`px-4 py-2 text-sm rounded-md text-white ${
                        metricsMap[`${currentItem.ticker}-${currentItem.date}`] 
                          ? 'bg-primary-500 hover:bg-primary-600' 
                          : 'bg-green-500 hover:bg-green-600'
                      }`}
                    >
                      {metricsMap[`${currentItem.ticker}-${currentItem.date}`] ? 'Update' : 'Add'} Metrics
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal for company configuration */}
      {showConfigModal && currentConfigItem && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowConfigModal(false)}></div>
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto relative z-50">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-neutral-800">
                    Configure {currentConfigItem.ticker}
                  </h2>
                  <button
                    onClick={() => setShowConfigModal(false)}
                    className="text-neutral-500 hover:text-neutral-700"
                  >
                    &times;
                  </button>
                </div>
              
              {/* Configuration form */}
              <form onSubmit={handleSubmitConfig(onConfigSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    {...registerConfig("base_url", { required: true })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="https://example.com/investor-relations"
                  />
                  {configErrors.base_url && (
                    <p className="text-error-500 text-xs mt-1">Base URL is required</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Extraction Method
                  </label>
                  <select
                    {...registerConfig("extraction_method", { required: true })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="requests">Requests</option>
                  </select>
                  {configErrors.extraction_method && (
                    <p className="text-error-500 text-xs mt-1">Extraction method is required</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    CSS Selector
                  </label>
                  <input
                    type="text"
                    {...registerConfig("selector", { required: false })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder=".press-releases li a"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Page Content Selector
                  </label>
                  <input
                    type="text"
                    {...registerConfig("page_content_selector", { required: false })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="body"
                    defaultValue="body"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Browser Type
                  </label>
                  <select
                    {...registerConfig("browser_type", { required: true })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="chromium">Chromium</option>
                    <option value="firefox">Firefox</option>
                    <option value="webkit">WebKit</option>
                  </select>
                  {configErrors.browser_type && (
                    <p className="text-error-500 text-xs mt-1">Browser type is required</p>
                  )}
                </div>
                
                <div className="border-t border-gray-200 mt-6 pt-6">
                  <h3 className="text-sm font-medium text-neutral-700 mb-3">Verification Keywords</h3>
                  
                  <div className="flex items-center mb-2">
                    <input
                      type="checkbox"
                      id="requires_year"
                      {...registerConfig("verify_keywords.requires_year")}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="requires_year" className="ml-2 block text-sm text-gray-700">
                      Requires Year
                    </label>
                  </div>
                  
                  <div className="flex items-center mb-2">
                    <input
                      type="checkbox"
                      id="requires_quarter"
                      {...registerConfig("verify_keywords.requires_quarter")}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="requires_quarter" className="ml-2 block text-sm text-gray-700">
                      Requires Quarter
                    </label>
                  </div>
                  
                  <div className="flex items-center mb-2">
                    <input
                      type="checkbox"
                      id="quarter_with_q"
                      {...registerConfig("verify_keywords.quarter_with_q")}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="quarter_with_q" className="ml-2 block text-sm text-gray-700">
                      Quarter with Q (e.g., "Q1" instead of "1")
                    </label>
                  </div>
                </div>
                
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(false)}
                    className="px-4 py-2 text-sm bg-neutral-100 text-neutral-700 rounded-md hover:bg-neutral-200 mr-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm rounded-md text-white bg-blue-500 hover:bg-blue-600"
                  >
                    Save Configuration
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
};

export default Messages;
