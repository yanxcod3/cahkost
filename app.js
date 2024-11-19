require('dotenv').config();
const createError = require('http-errors');
const express = require('express');
const path = require('path');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const bodyParser = require('body-parser');

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const Sequelize = require('sequelize');
const MySQLStore = require('connect-session-sequelize')(session.Store);

const indexRouter = require('./routes/index');
const app = express();

const sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  logging: false
});

const sessionStore = new MySQLStore({
  db: sequelize,
  expiration: 10800000,
  checkExpirationInterval: 600000,
  endSessionOnClose: false,
}, sequelize);

app.use(session({
  secret: 'c@hk05t_session',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 10800000,
    httpOnly: true,
    secure: false
  }
}));

sequelize.sync().then(() => {
  console.log('Session store berhasil disinkronisasi dengan database');
});

app.use(flash());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/assets', express.static('public'));
app.use('/', indexRouter);

app.use(function(req, res, next) {
  res.status(404).render('404', { title: '404 Page Not Found' });
});

app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});


const port = process.env.PORT || 3000;
app.listen(port);
console.log('Listening on http://localhost:'+ port);