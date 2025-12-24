const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const activeConnections = new Set();

// Log connection config (without password) for debugging
const dbConfig = {
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306'),
  
  // Conservative pool settings
  connectionLimit: 5,
  waitForConnections: false,
  queueLimit: 0,
  connectTimeout: 10000,
  idleTimeout: 30000,
  maxIdle: 2,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  namedPlaceholders: true
};

console.log('Database Configuration:', {
  host: dbConfig.host,
  user: dbConfig.user,
  database: dbConfig.database,
  port: dbConfig.port,
  connectionLimit: dbConfig.connectionLimit,
  usingEnv: {
    host: !!process.env.DB_HOST,
    user: !!process.env.DB_USER,
    password: !!process.env.DB_PASSWORD,
    database: !!process.env.DB_NAME
  }
});

const pool = mysql.createPool(dbConfig);

// Connection monitoring
pool.on('acquire', (connection) => {
  activeConnections.add(connection.threadId);
  console.log(`Connection acquired (${connection.threadId}), Active: ${activeConnections.size}`);
  
  // Set timeout to detect leaks
  connection.leakTimer = setTimeout(() => {
    console.error(`Connection ${connection.threadId} potentially leaked!`);
  }, 60000);
});

pool.on('release', (connection) => {
  activeConnections.delete(connection.threadId);
  clearTimeout(connection.leakTimer);
  console.log(`Connection released (${connection.threadId}), Active: ${activeConnections.size}`);
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
  
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('❌ Database Access Denied!');
    console.error('   User:', err.sqlMessage?.match(/user '([^']+)'/)?.[1] || dbConfig.user);
    console.error('   Possible causes:');
    console.error('   1. Incorrect password');
    console.error('   2. IP address not whitelisted in database');
    console.error('   3. User does not have permission from this IP');
    console.error('   4. User does not exist');
    console.error('   Check your .env file or database server settings.');
  } else if (err.code === 'ER_USER_LIMIT_REACHED') {
    console.log('Waiting 10 seconds before retrying...');
    setTimeout(() => pool.getConnection().then(conn => conn.release()).catch(e => console.error('Retry failed:', e)), 10000);
  } else if (err.code === 'ECONNREFUSED') {
    console.error('❌ Connection Refused!');
    console.error('   Check if database server is running and accessible');
    console.error('   Host:', dbConfig.host, 'Port:', dbConfig.port);
  } else if (err.code === 'ETIMEDOUT') {
    console.error('❌ Connection Timeout!');
    console.error('   Database server is not responding');
  }
});

// Health check
async function checkPoolHealth() {
  try {
    // mysql2 doesn't expose totalCount/idleCount directly, so we track manually
    const poolInfo = {
      active: activeConnections.size,
      limit: dbConfig.connectionLimit
    };
    console.log(`Pool status: Active=${poolInfo.active}/${poolInfo.limit}`);
    
    if (activeConnections.size > dbConfig.connectionLimit * 0.8) {
      console.warn('WARNING: Approaching connection limit!');
    }
    
    // Try to get a connection to verify pool health
    const testConn = await pool.getConnection();
    await testConn.ping();
    testConn.release();
  } catch (err) {
    console.error('Pool health check failed:', err.message);
  }
}

setInterval(checkPoolHealth, 30000);

// Graceful shutdown
const shutdown = async () => {
  console.log('\nClosing pool with', activeConnections.size, 'active connections...');
  await pool.end();
  process.exit();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = pool;