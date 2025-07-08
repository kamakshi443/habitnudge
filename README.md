# habitnudge

◉ Firestore: Configure security rules and indexes files for Firestore
◉ Functions: Configure a Cloud Functions directory and its files


const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const  db  = require('./firebaseService');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

console.log("DB", db)
app.get('/', (req, res) => res.send('Habit Nudge API running ✅'));
// POST /auth/register – Register New User
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, userId } = req.body;

    if (!name || !email || !userId) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (doc.exists) {
      return res.status(409).json({ error: "User already exists" });
    }

    await userRef.set({
      name,
      email,
      createdAt: new Date(),
      lastCheckedDate: new Date().toISOString().split('T')[0]
    });

    res.status(201).json({ success: true, message: "User registered" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /auth/login – Authenticate (basic simulation for now)
app.post('/auth/login', async (req, res) => {
  try {
    const { userId } = req.body;

    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = doc.data();
    res.status(200).json({ success: true, user: userData });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /users/:id – Get User Profile
app.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ user: userDoc.data() });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// PUT /users/:id – Update User Profile
app.put('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = req.body;

    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update(updates);
    res.status(200).json({ success: true, message: "User updated" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📌 Create Habit
app.post('/createHabit', async (req, res) => {
  try {
    const { userId, title, frequency, reminderTime } = req.body;

    if (!userId || !title || !frequency || !reminderTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const docRef = db.collection('users')
      .doc(userId)
      .collection('habits')
      .doc(); // auto-generated habit ID

    await docRef.set({
      title,
      frequency,
      reminderTime,
      xp: 0,
      streak: 0,
      completionLog: [],
      createdAt: new Date()
    });

    res.status(200).json({ success: true, id: docRef.id });

  } catch (err) {
    console.error('🔥 Error in /createHabit:', err);
    res.status(500).json({ error: err.message });
  }
});
// Fetch All Habits for a User
app.get('/habits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const habitsSnapshot = await db.collection('users').doc(userId).collection('habits').get();

    const habits = [];
    habitsSnapshot.forEach(doc => {
      habits.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({ habits });
  } catch (err) {
    console.error('Error fetching habits:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// Mark Habit as Completed for Today
app.put('/habit/:userId/:habitId/complete', async (req, res) => {
  try {
    const { userId, habitId } = req.params;
    const habitRef = db.collection('users').doc(userId).collection('habits').doc(habitId);
    const doc = await habitRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const habit = doc.data();
    const today = new Date().toISOString().split('T')[0];
  // Check if today is already in the completionLog
    const alreadyCompletedToday = (habit.completionLog || []).includes(today);

    if (alreadyCompletedToday) {
      return res.status(400).json({ message: 'Habit already completed today' });
    }

    const updatedLog = [...(habit.completionLog || []), today];
    const newXP = habit.xp + 10;
    const newStreak = habit.streak + 1;

    await habitRef.update({
      completionLog: updatedLog,
      xp: newXP,
      streak: newStreak
    });

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Error completing habit:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// DELETE /habit/:userId/:habitId → Delete a Habit
app.delete('/habit/:userId/:habitId', async (req, res) => {
  try {
    const { userId, habitId } = req.params;
    const ref = db.collection('users').doc(userId).collection('habits').doc(habitId);
    await ref.delete();
    res.status(200).json({ success: true, message: "Habit deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// View Single Habit Details
app.get('/habit/:userId/:habitId', async (req, res) => {
  const { userId, habitId } = req.params;
  try {
    const doc = await db.collection('users').doc(userId).collection('habits').doc(habitId).get();
    if (!doc.exists) return res.status(404).json({ error: "Habit not found" });

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update habit details (title, frequency, reminderTime)
app.put('/habit/:userId/:habitId/update', async (req, res) => {
  try {
    const { userId, habitId } = req.params;
    const { title, frequency, reminderTime } = req.body;

    const habitRef = db.collection('users').doc(userId).collection('habits').doc(habitId);
    const doc = await habitRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (frequency !== undefined) updates.frequency = frequency;
    if (reminderTime !== undefined) updates.reminderTime = reminderTime;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await habitRef.update(updates);

    res.status(200).json({
      success: true,
      message: 'Habit updated successfully',
      updatedFields: updates
    });

  } catch (err) {
    console.error('Error updating habit:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// GET /dashboard/:userId — Habit Insights API
// This endpoint will return:

// ✅ Total habits

// ✅ Total XP

// ✅ Longest streak

// ✅ Days completed this week

// ✅ Missed habits today

app.get('/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const snapshot = await db.collection('users').doc(userId).collection('habits').get();

    let totalHabits = 0;
    let totalXP = 0;
    let longestStreak = 0;
    let completedToday = 0;
    let missedToday = 0;

    const today = new Date().toISOString().split('T')[0];

    // Get Monday of this week
    const todayDate = new Date();
    const dayIndex = todayDate.getDay(); // Sunday = 0
    const diffToMonday = (dayIndex + 6) % 7;
    const monday = new Date(todayDate);
    monday.setDate(todayDate.getDate() - diffToMonday);
    const mondayISO = monday.toISOString().split('T')[0];

    let completedThisWeek = 0;

    snapshot.forEach(doc => {
      const habit = doc.data();
      totalHabits += 1;
      totalXP += habit.xp || 0;
      longestStreak = Math.max(longestStreak, habit.streak || 0);

      const log = habit.completionLog || [];

      // Completed today
      if (log.includes(today)) completedToday += 1;
      else missedToday += 1;

      // Completed this week
      const thisWeekCompletions = log.filter(date => date >= mondayISO && date <= today);
      completedThisWeek += thisWeekCompletions.length;
    });

    res.status(200).json({
      totalHabits,
      totalXP,
      longestStreak,
      completedToday,
      completedThisWeek,
      missedToday
    });

  } catch (err) {
    console.error('Error generating dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /users/:userId/xp – Add XP for Actions
// 🔁 You can call this every time a user completes a habit (already implemented), and also allow bonus XP from streaks, challenges, etc.
app.post('/users/:userId/xp', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount = 10 } = req.body;

    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const currentXP = doc.data().xp || 0;
    const newXP = currentXP + amount;

    await userRef.update({ xp: newXP });

    res.status(200).json({ success: true, xp: newXP });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /users/:userId/badges – Get Earned Badges

app.get('/users/:userId/badges', async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const badges = doc.data().badges || [];
    res.status(200).json({ badges });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
