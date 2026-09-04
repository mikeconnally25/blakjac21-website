/**
 * Vercel Speed Insights
 * This file initializes Vercel Speed Insights for tracking page performance.
 * Based on @vercel/speed-insights package v2.0.0
 */

(function() {
  'use strict';

  // Initialize the queue for Speed Insights
  function initQueue() {
    if (window.si) return;
    window.si = function() {
      window.siq = window.siq || [];
      window.siq.push(arguments);
    };
  }

  // Check if we're in a browser environment
  function isBrowser() {
    return typeof window !== 'undefined';
  }

  // Detect environment (development vs production)
  function detectEnvironment() {
    try {
      // In production builds, this won't be defined
      if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
        return process.env.NODE_ENV === 'development' ? 'development' : 'production';
      }
    } catch (e) {
      // Ignore errors
    }
    // Default to production
    return 'production';
  }

  function isDevelopment() {
    return detectEnvironment() === 'development';
  }

  // Get the appropriate script source URL
  function getScriptSrc(props) {
    props = props || {};
    
    if (props.scriptSrc) {
      return makeAbsolute(props.scriptSrc);
    }
    
    if (isDevelopment()) {
      return 'https://va.vercel-scripts.com/v1/speed-insights/script.debug.js';
    }
    
    if (props.dsn) {
      return 'https://va.vercel-scripts.com/v1/speed-insights/script.js';
    }
    
    if (props.basePath) {
      return makeAbsolute(props.basePath + '/speed-insights/script.js');
    }
    
    return '/_vercel/speed-insights/script.js';
  }

  // Make URL absolute
  function makeAbsolute(url) {
    if (!url) return url;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') 
      ? url 
      : '/' + url;
  }

  // Main function to inject Speed Insights
  function injectSpeedInsights(props) {
    props = props || {};
    
    if (!isBrowser() || props.route === null) {
      return null;
    }

    initQueue();

    var src = getScriptSrc(props);
    
    // Check if script is already loaded
    if (document.head.querySelector('script[src*="' + src + '"]')) {
      return null;
    }

    // Set up beforeSend if provided
    if (props.beforeSend && window.si) {
      window.si('beforeSend', props.beforeSend);
    }

    // Create and configure the script element
    var script = document.createElement('script');
    script.src = src;
    script.defer = true;

    // Set up dataset attributes
    var dataset = {
      sdkn: '@vercel/speed-insights',
      sdkv: '2.0.0'
    };

    if (props.framework) {
      dataset.sdkn = '@vercel/speed-insights/' + props.framework;
    }

    if (props.sampleRate) {
      dataset.sampleRate = String(props.sampleRate);
    }

    if (props.route) {
      dataset.route = props.route;
    }

    if (isDevelopment() && props.debug === false) {
      dataset.debug = 'false';
    }

    if (props.dsn) {
      dataset.dsn = props.dsn;
    }

    if (props.endpoint) {
      dataset.endpoint = makeAbsolute(props.endpoint);
    } else if (props.basePath) {
      dataset.endpoint = makeAbsolute(props.basePath + '/speed-insights/vitals');
    }

    // Apply dataset to script element
    for (var key in dataset) {
      if (dataset.hasOwnProperty(key)) {
        script.dataset[key] = dataset[key];
      }
    }

    // Error handler
    script.onerror = function() {
      console.log(
        '[Vercel Speed Insights] Failed to load script from ' + src + 
        '. Please check if any content blockers are enabled and try again.'
      );
    };

    // Append script to head
    document.head.appendChild(script);

    return {
      setRoute: function(route) {
        script.dataset.route = route || undefined;
      }
    };
  }

  // Initialize Speed Insights when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      injectSpeedInsights();
    });
  } else {
    // DOM is already ready
    injectSpeedInsights();
  }
})();
