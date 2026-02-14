module.exports = {
  apps: [
    {
      name: 'botcraft-server',
      cwd: '/opt/botcraft/server',
      script: 'src/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Auto-restart
      watch: false,
      max_memory_restart: '512M',
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/botcraft/server-error.log',
      out_file: '/var/log/botcraft/server-out.log',
      merge_logs: true,
    },
    {
      name: 'victorio',
      cwd: '/opt/botcraft/packages/molty-mind',
      script: 'run.js',
      env: {
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: 'REPLACE_WITH_YOUR_KEY',
        BOTCRAFT_SERVER: 'ws://localhost:3000',
      },
      // Start after server is up
      wait_ready: false,
      // Auto-restart with delay (so server has time to start)
      restart_delay: 5000,
      watch: false,
      max_memory_restart: '256M',
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/botcraft/victorio-error.log',
      out_file: '/var/log/botcraft/victorio-out.log',
      merge_logs: true,
    },
  ],
};
