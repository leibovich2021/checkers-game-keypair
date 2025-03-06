const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",  // בפיתוח מקומי אפשר לאפשר הכל
    methods: ["GET", "POST"]
  }
});

// הוסף נתיב דיבוג לבדיקת מצב המשחקים
app.get('/debug-games', (req, res) => {
  const gamesInfo = {};
  for (const [id, game] of Object.entries(games)) {
    gamesInfo[id] = {
      players: game.players,
      currentTurn: game.currentTurn,
      boardSample: game.board ? 'Board exists' : 'No board'
    };
  }
  
  res.json({
    gamesCount: Object.keys(games).length,
    games: gamesInfo
  });
});

const games = {}; // מאגר המשחקים

// יצירת לוח דמקה התחלתי
function createInitialBoard() {
  const board = Array(8).fill().map(() => Array(8).fill(null));
  
  // הצבת כלים לשחקן הראשון (3 שורות תחתונות)
  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = { owner: null, isKing: false }; // יעודכן אחרי חיבור השחקן
      }
    }
  }
  
  // הצבת כלים לשחקן השני (3 שורות עליונות)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = { owner: null, isKing: false }; // יעודכן אחרי חיבור השחקן
      }
    }
  }
  
  return board;
}

// בדיקת תקפות מהלך
function isValidMove(board, fromPos, toPos, playerId) {
  const { row: fromRow, col: fromCol } = fromPos;
  const { row: toRow, col: toCol } = toPos;
  
  // בדיקה שהמיקום החדש בתוך הלוח
  if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) {
    return false;
  }
  
  // בדיקה שהמיקום החדש ריק
  if (board[toRow][toCol] !== null) {
    return false;
  }
  
  const piece = board[fromRow][fromCol];
  
  // בדיקה שיש כלי במיקום ההתחלתי ושהוא שייך לשחקן
  if (!piece || piece.owner !== playerId) {
    return false;
  }
  
  const rowDiff = Math.abs(toRow - fromRow);
  const colDiff = Math.abs(toCol - fromCol);
  
  // מהלך רגיל - דיאגונלי ומרחק של משבצת אחת
  if (rowDiff === 1 && colDiff === 1) {
    // רק מלך יכול לנוע לכל הכיוונים
    if (!piece.isKing) {
      // שחקן 1 נע למעלה, שחקן 2 נע למטה
      const players = Object.values(games).find(game => 
        game.players.includes(playerId)
      ).players;
      const isFirstPlayer = players[0] === playerId;
      
      if (isFirstPlayer && toRow >= fromRow) {
        return false;
      }
      if (!isFirstPlayer && toRow <= fromRow) {
        return false;
      }
    }
    return true;
  }
  
  // אכילה - דיאגונלי ומרחק של 2 משבצות
  if (rowDiff === 2 && colDiff === 2) {
    const midRow = (fromRow + toRow) / 2;
    const midCol = (fromCol + toCol) / 2;
    const midPiece = board[midRow][midCol];
    
    // בדיקה שיש כלי של היריב באמצע
    if (!midPiece || midPiece.owner === playerId) {
      return false;
    }
    
    // רק מלך יכול לנוע לכל הכיוונים
    if (!piece.isKing) {
      // שחקן 1 נע למעלה, שחקן 2 נע למטה
      const players = Object.values(games).find(game => 
        game.players.includes(playerId)
      ).players;
      const isFirstPlayer = players[0] === playerId;
      
      if (isFirstPlayer && toRow >= fromRow) {
        return false;
      }
      if (!isFirstPlayer && toRow <= fromRow) {
        return false;
      }
    }
    
    return true;
  }
  
  return false;
}

// ביצוע מהלך על הלוח
function makeMove(board, fromPos, toPos, playerId) {
  const { row: fromRow, col: fromCol } = fromPos;
  const { row: toRow, col: toCol } = toPos;
  
  // העתקת הלוח
  const newBoard = JSON.parse(JSON.stringify(board));
  
  // העברת הכלי
  const piece = newBoard[fromRow][fromCol];
  newBoard[toRow][toCol] = piece;
  newBoard[fromRow][fromCol] = null;
  
  // בדיקה אם זו אכילה
  if (Math.abs(toRow - fromRow) === 2) {
    const midRow = (fromRow + toRow) / 2;
    const midCol = (fromCol + toCol) / 2;
    newBoard[midRow][midCol] = null; // הסרת הכלי שנאכל
  }
  
  // בדיקה אם צריך להפוך למלך
  if ((playerId === newBoard[toRow][toCol].owner) && 
     ((toRow === 0 && newBoard[toRow][toCol].owner === board[fromRow][fromCol].owner) || 
      (toRow === 7 && newBoard[toRow][toCol].owner !== board[fromRow][fromCol].owner))) {
    newBoard[toRow][toCol].isKing = true;
  }
  
  return newBoard;
}

// בדיקה אם המשחק הסתיים
function checkGameEnd(board, playerId) {
  const opponentId = Object.values(games).find(game => 
    game.players.includes(playerId)
  ).players.find(id => id !== playerId);
  
  let playerPieces = 0;
  let opponentPieces = 0;
  
  // ספירת הכלים של כל שחקן
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (board[row][col]) {
        if (board[row][col].owner === playerId) {
          playerPieces++;
        } else if (board[row][col].owner === opponentId) {
          opponentPieces++;
        }
      }
    }
  }
  
  if (playerPieces === 0) {
    return opponentId; // היריב ניצח
  }
  
  if (opponentPieces === 0) {
    return playerId; // השחקן ניצח
  }
  
  return null; // המשחק עדיין מתנהל
}

// ניקוי משחקים ישנים כל 5 דקות
setInterval(() => {
  const now = Date.now();
  Object.entries(games).forEach(([id, game]) => {
    if (game.createdAt && now - game.createdAt > 30 * 60 * 1000) { // מחק משחקים אחרי 30 דקות
      delete games[id];
      console.log(`Cleaned up old game: ${id}`);
    }
  });
}, 5 * 60 * 1000);

// התחלת השרת והאזנה לאירועים
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // יצירת משחק חדש
  socket.on('create-game', () => {
    const gameId = uuidv4().substring(0, 6); // מזהה מקוצר
    
    games[gameId] = {
      players: [socket.id],
      board: createInitialBoard(),
      currentTurn: null, // יקבע כשהשחקן השני יתחבר
      createdAt: Date.now() // הוסף חותמת זמן
    };
    
    socket.join(gameId);
    socket.emit('game-created', { gameId });
    
    console.log(`Game created: ${gameId}`);
    console.log(`Available games now: ${Object.keys(games).join(', ')}`);
  });

  // הצטרפות למשחק קיים
  socket.on('join-game', ({ gameId }) => {
    // דיבוג משופר
    console.log(`Player ${socket.id} is trying to join game ${gameId}`);
    console.log(`Available games: ${Object.keys(games).join(', ')}`);
    
    // בדיקה שהמשחק קיים ויש מקום
    if (!games[gameId]) {
      console.log(`Game ${gameId} not found`);
      socket.emit('error', { message: 'Game not found or full' });
      return;
    }
    
    if (games[gameId].players.length >= 2) {
      console.log(`Game ${gameId} is already full`);
      socket.emit('error', { message: 'Game not found or full' });
      return;
    }
    
    // בדיקה אם השחקן כבר במשחק
    if (games[gameId].players.includes(socket.id)) {
      console.log(`Player ${socket.id} is already in game ${gameId}`);
      return;
    }
    
    // הצטרפות למשחק
    games[gameId].players.push(socket.id);
    socket.join(gameId);
    
    // קביעת בעלות על הכלים
    const board = games[gameId].board;
    
    // עדכון כלי השחקן הראשון (למטה)
    for (let row = 5; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1 && board[row][col]) {
          board[row][col].owner = games[gameId].players[0];
        }
      }
    }
    
    // עדכון כלי השחקן השני (למעלה)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1 && board[row][col]) {
          board[row][col].owner = games[gameId].players[1];
        }
      }
    }
    
    // קביעת התור הראשון
    games[gameId].currentTurn = games[gameId].players[0];
    
    // דיבוג מצב המשחק לאחר עדכון
    console.log(`Game ${gameId} players after join:`, games[gameId].players);
    console.log(`Current turn set to: ${games[gameId].currentTurn}`);
    
    // שליחת עדכון לשני השחקנים - פעם אחת בלבד
    io.to(gameId).emit('player-joined', { 
      gameId, 
      players: games[gameId].players 
    });
    
    io.to(gameId).emit('board-updated', { 
      board: games[gameId].board,
      currentTurn: games[gameId].currentTurn
    });
    
    console.log(`Player ${socket.id} joined game ${gameId}`);
  });

  // ביצוע מהלך
  socket.on('make-move', ({ gameId, playerId, fromPos, toPos }) => {
    console.log(`Player ${playerId} attempting move in game ${gameId}`);
    
    // בדיקה שהמשחק קיים ושזה התור של השחקן
    if (!games[gameId]) {
      console.log(`Game ${gameId} not found for move`);
      return;
    }
    
    if (games[gameId].currentTurn !== playerId) {
      console.log(`Not ${playerId}'s turn in game ${gameId}`);
      return;
    }
    
    // בדיקת תקפות המהלך
    if (!isValidMove(games[gameId].board, fromPos, toPos, playerId)) {
      console.log(`Invalid move from ${JSON.stringify(fromPos)} to ${JSON.stringify(toPos)}`);
      return;
    }
    
    console.log(`Valid move from ${JSON.stringify(fromPos)} to ${JSON.stringify(toPos)}`);
    
    // ביצוע המהלך
    games[gameId].board = makeMove(games[gameId].board, fromPos, toPos, playerId);
    
    // החלפת תור
    const currentPlayerIndex = games[gameId].players.indexOf(playerId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % 2;
    games[gameId].currentTurn = games[gameId].players[nextPlayerIndex];
    
    // שליחת עדכון לוח לשני השחקנים
    io.to(gameId).emit('board-updated', {
      board: games[gameId].board,
      currentTurn: games[gameId].currentTurn
    });
    
    // בדיקה אם המשחק הסתיים
    const winner = checkGameEnd(games[gameId].board, playerId);
    if (winner) {
      console.log(`Game ${gameId} ended. Winner: ${winner}`);
      io.to(gameId).emit('game-ended', { winner });
      delete games[gameId]; // מחיקת המשחק מהמאגר
    }
  });

  // ניתוק
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // חיפוש משחק שהשחקן השתתף בו
    const gameToRemove = Object.entries(games).find(([id, game]) => 
      game.players.includes(socket.id)
    );
    
    if (gameToRemove) {
      const [gameId, game] = gameToRemove;
      
      // אם המשחק כבר התחיל (יש 2 שחקנים), יש להודיע לשחקן השני
      if (game.players.length === 2) {
        const otherPlayerId = game.players.find(id => id !== socket.id);
        io.to(otherPlayerId).emit('game-ended', { 
          winner: otherPlayerId,
          reason: 'opponent-disconnected'
        });
      }
      
      // מחיקת המשחק מהמאגר
      delete games[gameId];
      console.log(`Game ${gameId} removed after player disconnect`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});