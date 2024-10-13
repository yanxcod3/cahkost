const express = require('express');
const passport = require('passport');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const crypto = require('crypto');
const FormData = require('form-data');
const axios = require('axios');
const multer = require('multer');
const midtransClient = require('midtrans-client');

const router = express.Router();
const database = require('../database');

function DateTime() {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  
  const now = new Date();
  const day = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
}

function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
}

async function uploadImage(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const form = new FormData();
  form.append('image', fileStream);
  const res = await axios.post(
    `https://api.imgbb.com/1/upload?key=87fd9d325e81f321c5f7a173d73e89ba`,
    form,
    { headers: form.getHeaders() }
  );

  return res.data.data.url;
}

function convertText(text) {
  return text
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function convertToNumber(price) {
  const cleanedString = price.replace('Rp ', '').replace(/\./g, '');
  const numberValue = parseInt(cleanedString, 10);
  return numberValue;
}

function generateID(input) {
  if (input === 'product') {
    return Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
  }
}

async function compressImage(inputBuffer, targetFilePath) {
  let targetSizeKB = 200;
  let width = 1920;
  let quality = 80;
  let outputBuffer = inputBuffer;
  let outputSizeKB = inputBuffer.length / 1024;

  const metadata = await sharp(inputBuffer).metadata();
  const height = Math.round((width / metadata.width) * metadata.height);

  while (outputSizeKB > targetSizeKB && quality > 10) {
      outputBuffer = await sharp(inputBuffer)
          .resize(width, height)
          .jpeg({ quality })
          .toBuffer();
      outputSizeKB = outputBuffer.length / 1024;
      quality -= 5;
  }

  return sharp(outputBuffer).toFile(targetFilePath);
}

async function compressImages(req, data, options) {
  let inputs = [];

  if (req.file) {
    inputs = [req.file.buffer];
  } else if (req.files) {
    if (Array.isArray(req.files)) {
      inputs = req.files.map(file => file.buffer);
    } else {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          inputs.push(file.buffer);
        });
      });
    }
  }

  let outputDirectory;
  let targetFilePaths = [];
  if (options.query === 'profile') {
    outputDirectory = `public/uploads/${data.user_email}/profile`;
    targetFilePaths.push(path.join(outputDirectory, `${data.user_email.split('@')[0]}.jpeg`));
  } else if (options.query === 'premium') {
    outputDirectory = `public/uploads/${data.user_email}/dokumen`;
    if (req.files['ktp']) {
      targetFilePaths.push(path.join(outputDirectory, `KTP_${data.user_email.split('@')[0]}.jpeg`));
    }
    if (req.files['selfie']) {
      targetFilePaths.push(path.join(outputDirectory, `SELFIE_${data.user_email.split('@')[0]}.jpeg`));
    }
  } else if (options.query === 'payment') {
    outputDirectory = `public/uploads/${data.user_email}/ktp`;
    targetFilePaths.push(path.join(outputDirectory, `KTP_${req.body.nama}.jpeg`));
  } else if (options.query === 'product') {
    outputDirectory = `public/uploads/${data.user_email}/product/${options.id}`;
    targetFilePaths = req.files.map((file, index) => {
      return path.join(outputDirectory, `${index + 1}.jpeg`);
    });
  }

  if (!fs.existsSync(outputDirectory)) {
    await fs.promises.mkdir(outputDirectory, { recursive: true });
  }

  const promises = inputs.map((input, index) => {
    return compressImage(input, targetFilePaths[index]);
  });

  return Promise.all(promises);
}

let snap = new midtransClient.Snap({
  isProduction: false,
  clientKey: process.env.MIDTRANS_CLIENT_ID,
  serverKey: process.env.MIDTRANS_CLIENT_SERVER
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const folderPaths = {
  folder1: path.join(__dirname, '..', 'public', 'home', 'kualitas'),
  folder2: path.join(__dirname, '..', 'public', 'home', 'promo'),
  folder3: path.join(__dirname, '..', 'public', 'home', 'solusi')
};

const readFiles = (folderPath) => {
  return new Promise((resolve, reject) => {
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        return reject(err);
      }
      const imageFiles = files.filter(file => {
        return file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg');
      });
      resolve(imageFiles);
    });
  });
};

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  secure: false,
  auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
  },
});

const head = {
  title: "CAHKOST - Platform Penyedia Kost",
  icon: "/assets/images/favicon.png",
  desc: "anggaplah ini sebagai rumah sendiri di mana pun anda pergi."
}

router.get('/random-image', async (req, res) => {
  try {
      const folderPath = path.join(__dirname, '../public/home/bg');
      const files = await fs.promises.readdir(folderPath);
      const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|svg)$/.test(file));

      if (imageFiles.length === 0) {
          return res.status(404).send('Tidak ada gambar di folder.');
      }

      const randomIndex = Math.floor(Math.random() * imageFiles.length);
      const selectedImage = imageFiles[randomIndex];
      const imagePath = path.join(folderPath, selectedImage);

      res.sendFile(imagePath);
  } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Terjadi kesalahan dalam mengambil gambar.');
  }
});

/* MAIN PAGE */

router.get('/', function(req, res, next) {
  Promise.all([
    readFiles(folderPaths.folder1),
    readFiles(folderPaths.folder2),
    readFiles(folderPaths.folder3)
  ])
  .then(results => {
    const folder1 = results[0];
    const folder2 = results[1];
    const folder3 = results[2];

    let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
    database.query(sql, [req.session.user_id], (err, data) => {
      database.query(`SELECT * FROM db_testimoni`, (err, result) => {
        res.render('home', { 
          head: head, 
          image: { folder1, folder2, folder3 }, 
          session: req.session, 
          user: data[0] ,
          alert: req.flash('alert'),
          orderID: req.flash('orderID'),
          token: req.flash('token'),
          testimoni: result
        });
      });
    });
  })
});


router.get('/category/kost-pria', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sUser = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  let sProduct = `SELECT * FROM db_product WHERE product_type = "KOST PRIA"`;

  Promise.all([
    new Promise((resolve, reject) => {
      database.query(sUser, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data[0]);
      });
    }),
    new Promise((resolve, reject) => {
      database.query(sProduct, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    })
  ]).then(([user, product]) => {
    res.render('category/kost-pria', { head: head, session: req.session, user: user, product: product, promo: false });
  });
});

router.get('/category/kost-wanita', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sUser = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  let sProduct = `SELECT * FROM db_product WHERE product_type = "KOST WANITA"`;

  Promise.all([
    new Promise((resolve, reject) => {
      database.query(sUser, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data[0]);
      });
    }),
    new Promise((resolve, reject) => {
      database.query(sProduct, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    })
  ]).then(([user, product]) => {
    res.render('category/kost-wanita', { head: head, session: req.session, user: user, product: product, promo: false });
  });
});

router.get('/category/kost-eksklusif', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sUser = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  let sProduct = `SELECT * FROM db_product WHERE product_type = "KOST EKSKLUSIF"`;

  Promise.all([
    new Promise((resolve, reject) => {
      database.query(sUser, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data[0]);
      });
    }),
    new Promise((resolve, reject) => {
      database.query(sProduct, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    })
  ]).then(([user, product]) => {
    res.render('category/kost-eksklusif', { head: head, session: req.session, user: user, product: product, promo: false });
  });
});

router.get('/category/promo', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sUser = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  let sProduct = `SELECT * FROM db_product WHERE product_promo != "0"`;

  Promise.all([
    new Promise((resolve, reject) => {
      database.query(sUser, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data[0]);
      });
    }),
    new Promise((resolve, reject) => {
      database.query(sProduct, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    })
  ]).then(([user, product]) => {
    res.render('category/promo', { head: head, session: req.session, user: user, product: product, promo: true });
  });
});

router.get('/about', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], (err, data) => {
    if (err) throw err;
    res.render('about', { head: head, session: req.session, user: data[0] });
  });
});

router.get('/profile', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], (err, data) => {
    if (err) throw err;
    res.render('profile/index', { head: head, session: req.session, user: data[0], action: '', alert: '' });
  });
});

router.get('/profile/history', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], (err, data) => {
    let order = `SELECT * FROM db_order WHERE order_email = "${data[0].user_email}"`;
    database.query(order, [data[0].user_email], (err, order) => {
      res.render('profile/history', { head: head, session: req.session, user: data[0], order: order });
    });
  });
});

router.get('/profile/product', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  database.query(`SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`, (err, data) => {
    database.query(`SELECT * FROM db_product WHERE product_owner = "${data[0].user_email}"`, (err, product) => {
      res.render('profile/product', { head: head, session: req.session, user: data[0], product: product});
    })
  })
});

router.get('/search', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  const { lokasi, kelas } = req.query
  const type = kelas.toUpperCase()

  let page;
  if (type.includes('PRIA')) {
    page = 'category/kost-pria'
  } else if (type.includes('WANITA')) {
    page = 'category/kost-wanita'
  } else if (type.includes('EKSKLUSIF')) {
    page = 'category/kost-eksklusif'
  }

  let sUser = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  let sProduct = `SELECT * FROM db_product WHERE product_type = "${type}"`;

  Promise.all([
    new Promise((resolve, reject) => {
      database.query(sUser, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data[0]);
      });
    }),
    new Promise((resolve, reject) => {
      database.query(sProduct, [req.session.user_id], (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    })
  ]).then(([user, product]) => {
    res.render(page, { head: head, session: req.session, user: user, product: product, promo: false });
  });
});

/* LOGIN & REGISTER */

router.get('/login', function(req, res, next) {
  if (req.session.user_id) {
    return res.redirect('/');
  }

  res.render('login', { head: head, session: req.session, alert: '' });
});

router.get('/register', function(req, res, next) {
  if (req.session.user_id) {
    return res.redirect('/');
  }

  res.render('register', { head: head, session: req.session, alert: '' });
});

router.get('/login/forgot-password', function(req, res, next) {
  if (req.session.user_id) {
    return res.redirect('/');
  }

  res.render('login', { head: head, session: req.session, alert: '' });
});

router.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
  const sEmail = `SELECT * FROM db_user WHERE user_email = "${req.user.emails[0].value}"`;
  const searchID = `SELECT user_id FROM db_user WHERE user_email = "${req.user.emails[0].value}";`

  database.query(sEmail, [req.user.emails[0].value], (error, results) => {
    if (results.length > 0) {
      database.query(searchID, [req.user.emails[0].value], (error, result) => {
        if (result.length > 0) {
            req.session.user_id = result[0].user_id;
            res.redirect('/');
        } else {
          res.render('register', { head: head, session: req.session, alert: 'Registration Failed' });
        }
      });
    } else {
      const iQuery = `    
      INSERT INTO db_user (user_profile, user_name, user_email)
      VALUES ("${req.user._json.picture}", "${req.user.displayName}","${req.user.emails[0].value}")
      `;

      database.query(iQuery, (error, result) => {
        database.query(searchID, [req.user.emails[0].value], (error, result) => {
          if (result.length > 0) {
              req.session.user_id = result[0].user_id;
              res.redirect('/');
          } else {
            res.render('register', { head: head, session: req.session, alert: 'Registration Failed' });
          }
        });
      });
    }
  });
});

router.post('/login', function(req, res, next) {
  const { email, password, remember_me } = req.body;

  database.query(`SELECT * FROM db_user WHERE user_email = "${email}"`, function(error, data) {
    if (data.length === 0) {
      return res.render('login', { head, session: req.session, alert: 'Incorrect Email' });
    }
    if (data[0].user_password !== password) {
      return res.render('login', { head, session: req.session, alert: 'Incorrect Password' });
    }

    req.session.user_id = data[0].user_id;
    if (remember_me) {
      req.session.cookie.maxAge = 3 * 24 * 60 * 60 * 1000;
    } else {
      req.session.cookie.expires = false;
    }

    req.flash('alert', 'Welcome');
    return res.redirect('/');
  });
});

router.post('/register', function(req, res, next) {
  
  const user_email = req.body.email;
  const user_password = req.body.password;
  const user_fakultas = req.body.faculty;

  if (user_email && user_password && user_fakultas) {
    if (user_fakultas == 'Pilih Fakultas') {
      return res.render('register', { head: head, session: req.session, alert: 'Not Faculty' }); 
    }
    if (user_password.length < 8) {
      return res.render('register', { head: head, session: req.session, alert: 'Password Minimum' });
    }

    const sEmail = `SELECT * FROM db_user WHERE user_email = "${user_email}"`;
    const searchID = `SELECT user_id FROM db_user WHERE user_email = "${user_email}";`
    
    database.query(sEmail, [user_email], (error, results) => {
      if (results.length > 0) {
        return res.render('register', { head: head, session: req.session, alert: 'Duplicate Account' });
      }

      const iQuery = `    
      INSERT INTO db_user (user_profile, user_name, user_email, user_password, user_fakultas)
      VALUES ("https://i.ibb.co.com/fndXd6y/profile-icon-png-910.png", "${user_email.split('@')[0]}","${user_email}", "${user_password}", "${user_fakultas}")
      `;

      database.query(iQuery, (error, result) => {
        database.query(searchID, [user_email], (error, result) => {
          if (result.length > 0) {
              req.session.user_id = result[0].user_id;
              req.flash('alert', 'welcome')
              res.redirect("/")
          } else {
            res.render('register', { head: head, session: req.session, alert: 'Registration Failed' });
          }
        });
      });
    });
  } else {
    res.render('register', { head: head, session: req.session, alert: 'Please fill in all fields.' });
  }
});

router.get('/logout', function(req, res, next) {
  req.session.destroy()
  res.redirect("/")
})

router.post('/login/forgot-password', function(req, res, next) {
  
  const user_email = req.body.email;

  const sEmail = `SELECT * FROM db_user WHERE user_email = "${user_email}"`;
  
  database.query(sEmail, [user_email], (error, results) => {
    if (results.length > 0) {
      const token = crypto.randomBytes(20).toString('hex');
      const expireDate = Date.now() + 15 * 60000;
      const iQuery = `INSERT INTO db_token (token_email, token_code, token_expired)
      VALUES ("${user_email}", "${token}", "${expireDate}")`;
      database.query(iQuery, [token, expireDate, user_email], (err) => {

        const mailOptions = {
            from: 'CAH KOST <admin@cahkost.my.id>',
            to: user_email,
            subject: 'Reset Password Request',
            text: `Klik link ini untuk mereset password Anda: https://cahkost.my.id/reset-password/${token}`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            res.render('login', { head: head, alert: 'Email Success' });
        });
      });
    } else {
      return res.render('login', { head: head, session: req.session, alert: 'Incorrect Email' });
    }
  });
});

router.get('/reset-password/:token', (req, res) => {
  const token = req.params.token;
  const sql = `SELECT * FROM db_token WHERE token_code = "${token}" AND token_expired > "${Date.now()}"`;
  database.query(sql, [token, Date.now()], (err, results) => {
    if (results.length > 0 && results[0].token_email != '') {
      res.render('reset-password', { head: head, token, email: results[0].token_email, alert : '' });
    } else {
      res.render('reset-password', { head: head, token : '', email: '', alert: 'Token Invalid' });
    }
  });
});

router.post('/reset-password/:token', (req, res) => {
  const token = req.params.token;
  const email = req.body.email;
  const newPassword = req.body.npassword;
  const confirmPassword = req.body.cpassword;

  if (newPassword.length < 8) {
    return res.render('reset-password', { head: head, token, email, alert: 'Password Minimum' });
  }
  if (newPassword == confirmPassword) {
    const sToken = `SELECT * FROM db_token WHERE token_code = "${token}" AND token_expired > "${Date.now()}"`;
    database.query(sToken, [token, Date.now()], (err, results) => {
      if (results.length > 0) {
        const sUser = `UPDATE db_user SET user_password = "${newPassword}" WHERE user_email = "${email}"`;
        database.query(sUser, (err) => {
          const dToken = `UPDATE db_token SET token_email = "" WHERE token_email = "${email}"`;
          database.query(dToken, (err) => {
            const uToken = `UPDATE db_token SET token_email = "" WHERE token_expired < "${Date.now()}"`;
            res.render('reset-password', { head: head, token, email, alert: 'Change Success' });
            database.query(uToken)
          });
        });
      } else {
        res.render('reset-password', { head: head, token : '', email: '', alert: 'Token Invalid' });
      }
    });
  } else {
    return res.render('reset-password', { head: head, token, email, alert: 'Password Not Same' });
  }
});

router.post('/profile', upload.single('profileInput'), async (req, res) => {
  const nama = req.body.nama;
  const gender = req.body.gender;
  const nohp = req.body.phone;
  const fakultas = req.body.faculty;
  const checkbox = req.body.checkbox
  const password = req.body.password;
  const newPassword = req.body.newpassword;
  const confirmPassword = req.body.confirmpassword;

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], async (err, data) => {
    const sUser = `UPDATE db_user SET user_name = "${nama}", user_kelamin = "${gender}", user_nohp = "${nohp}", user_fakultas = "${fakultas}" WHERE user_id = "${req.session.user_id}"`;
    if (checkbox) {
      if (password != data[0].user_password) {
        return res.render('profile/index', { head: head, session: req.session, user: data[0], action: 'edit', alert: 'Password Wrong' });
      } else {
        if (newPassword.length >= 8 && newPassword == confirmPassword) {
          const sPass = `UPDATE db_user SET user_password = "${newPassword}" WHERE user_id = "${req.session.user_id}"`;
          database.query(sPass)
        }
      }
    }
    if (req.file) {
        await compressImages(req, data[0], { query: 'profile' });
        const urlImage = await uploadImage(`public/uploads/${data[0].user_email}/profile/${data[0].user_email.split('@')[0]}.jpeg`)
        const sProfile = `UPDATE db_user SET user_profile = "${urlImage}" WHERE user_id = "${req.session.user_id}"`;
        database.query(sProfile)
    }
    database.query(sUser)
    database.query(`UPDATE db_testimoni SET testimoni_name = "${convertText(nama)}" WHERE testimoni_email = "${data[0].user_email}"`)
    res.render('profile/index', { head: head, session: req.session, user: data[0], action: '', alert: 'Update Success' });
  });
});

router.get('/profile/edit', function(req, res, next) {
  if (!req.session.user_id) {
    return res.redirect('/');
  }

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], (err, data) => {
    if (err) throw err;
    res.render('profile/index', { head: head, session: req.session, user: data[0], action: 'edit', alert: '' });
  });
});

router.post('/profile/product', upload.none(), async (req, res) => {
  const { id, action } = req.query; // Get 'id' and 'action' from query parameters
  database.query(`SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`, async (err, data) => {
    if (action === 'delete') {
      await database.query('DELETE FROM db_product WHERE product_id = ?', [id]);
      if (fs.existsSync(`public/uploads/${data[0].user_email}/product/${id}`)) {
        // Read all files and folders inside the directory
        const files = fs.readdirSync(`public/uploads/${data[0].user_email}/product/${id}`);
        
        files.forEach((file) => {
            const currentPath = path.join(`public/uploads/${data[0].user_email}/product/${id}`, file);
            if (fs.lstatSync(currentPath).isDirectory()) {
                // Recursively delete subdirectories
                deleteFolderRecursive(currentPath);
            } else {
                // Delete file
                fs.unlinkSync(currentPath);
            }
        });
        
        fs.rmdirSync(`public/uploads/${data[0].user_email}/product/${id}`);
      }
      return;
    } else if (action === 'edit') {
      const { nameKost, typeKost, alamatKost, deskripsiKost, priceKost, promoKost, promoPriceKost, fasilitasKamar, fasilitasBersama } = req.body;

      let promoPrice;
      if (promoKost < 5) {
        promoPrice = '0'
      } else {
        promoPrice = promoPriceKost
      }
    
      return database.query(`UPDATE db_product SET product_type = "${typeKost}", product_name = "${nameKost}", product_price = "${convertToNumber(priceKost)}", product_address = "${alamatKost}", product_fasilitasK = "${fasilitasKamar}", product_fasilitasB = "${fasilitasBersama}", product_deskripsi = "${deskripsiKost}", product_promo = "${convertToNumber(promoPrice)}" WHERE product_id = ${id}`)
    } else {
        return res.status(400).json({ message: 'Invalid action' });
    }
  })
});

router.get('/payment', function(req, res, next) {
  if (true) {
    return res.redirect('/');
  }
});

router.post('/payment', upload.single('ktpInput'), async (req, res) => {
  const orderID = req.body.orderid;
  const nameKost = req.body.namekost;
  const price = req.body.price;
  const nama = req.body.nama;
  const nohp = req.body.telepon;
  const durasi = req.body.amount;
  const tglMulai = req.body.tanggalmulai;
  const tglSelesai = req.body.tanggalselesai;
  const tglMasa = formatDate(tglMulai) + " s/d " + formatDate(tglSelesai) 

  let transaction = {
    "transaction_details": {
      "order_id": orderID,
      "gross_amount": price
    },
    "credit_card": {
      "secure": true
    }
  };

  let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
  database.query(sql, [req.session.user_id], async (err, data) => {
    await compressImages(req, data[0], { query: 'payment' });
    let kost = `SELECT * FROM db_product WHERE product_name = "${nameKost}"`
    database.query(kost, [nameKost], async (err, dataKost) => {snap.createTransaction(transaction)
      .then((transaction) => {
        const token = transaction.token;
        const order = `INSERT INTO db_order (order_id, order_date, product_type, product_name, product_owner, product_address, order_name, order_email, order_nohp, order_durasi, order_masa, order_price, order_token)
        VALUES ("${orderID}", "${DateTime()}", "${dataKost[0].product_type}", "${dataKost[0].product_name}", "${dataKost[0].product_owner}", "${dataKost[0].product_address}", "${nama}", "${data[0].user_email}", "${nohp}", "${durasi}", "${tglMasa}", "${price}", "${token}" )`;
        database.query(order)
        req.flash('token', token)
        res.redirect(`/?order_id=${orderID}&status_code=201&transaction_status=pending`)
      })
      .catch((error) => {
        console.error(error);
        res.status(500).send('Error processing transaction');
      });
    });
  });
});

router.post('/submit-premium', upload.fields([{ name: 'ktp' }, { name: 'selfie' }]), async (req, res) => {
  database.query(`SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`, async (err, data) => {
    await compressImages(req, data[0], { query: 'premium' });
    database.query(`UPDATE db_user SET user_premium = "request" WHERE user_email = "${data[0].user_email}"`)
    res.redirect('profile');
  })
})

router.post('/submit-product', upload.array('imageInput'), async (req, res) => {
  const { nameKost, typeKost, alamatKost, deskripsiKost, priceKost, promoKost, promoPriceKost, fasilitasKamar, fasilitasBersama } = req.body;

  let promoPrice;
  if (promoKost < 5) {
    promoPrice = '0'
  } else {
    promoPrice = promoPriceKost
  }

  database.query(`SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`, async (err, data) => {
    const productID = await generateID('product')
    await compressImages(req, data[0], { query: 'product', id: productID });
    database.query(`INSERT INTO db_product (product_id, product_type, product_owner, product_name, product_price, product_address, product_fasilitasK, product_fasilitasB, product_deskripsi, product_promo, product_gambar)
    VALUES ("${productID}", "${typeKost}", "${data[0].user_email}", "${nameKost}", "${convertToNumber(priceKost)}", "${alamatKost}", "${fasilitasKamar}", "${fasilitasBersama}", "${deskripsiKost}", "${convertToNumber(promoPrice)}", "${req.files.length}")`)
  });
});

router.post('/submit-product', upload.array('imageInput'), async (req, res) => {
  const { nameKost, typeKost, alamatKost, deskripsiKost, priceKost, promoKost, promoPriceKost, fasilitasKamar, fasilitasBersama } = req.body;

  let promoPrice;
  if (promoKost < 5) {
    promoPrice = '0'
  } else {
    promoPrice = promoPriceKost
  }

  database.query(`SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`, async (err, data) => {
    const productID = await generateID('product')
    await compressImages(req, data[0], { query: 'product', id: productID });
    database.query(`INSERT INTO db_product (product_id, product_type, product_owner, product_name, product_price, product_address, product_fasilitasK, product_fasilitasB, product_deskripsi, product_promo, product_gambar)
    VALUES ("${productID}", "${typeKost}", "${data[0].user_email}", "${nameKost}", "${convertToNumber(priceKost)}", "${alamatKost}", "${fasilitasKamar}", "${fasilitasBersama}", "${deskripsiKost}", "${convertToNumber(promoPrice)}", "${req.files.length}")`)
  });
});

router.post('/submit-testimoni', async (req, res) => {
  try {
    let sql = `SELECT * FROM db_user WHERE user_id = "${req.session.user_id}"`;
    database.query(sql, [req.session.user_id], async (err, data) => {
      const testimoni = `INSERT INTO db_testimoni (testimoni_order, testimoni_profile, testimoni_name, testimoni_email, testimoni_feedback)
      VALUES ("${req.body.orderID}", "${data[0].user_profile}", "${convertText(req.body.nama)}", "${data[0].user_email}", "${req.body.testimoni}")`
      database.query(testimoni)
    })
  } catch (err) {
    console.log(err)
  }
});

router.post('/notification', async (req, res) => {
  try {
    console.log('Received notification:', req.body);
    const notification = await snap.transaction.notification(req.body);
    const orderID = notification.order_id;
    const status = notification.transaction_status;

    if (status === 'settlement') {
        database.query(`UPDATE db_order SET order_status = "${status}", order_pembayaran = "${DateTime()}" WHERE order_id = "${orderID}"`)
    } else {
        database.query(`UPDATE db_order SET order_status = "${status}", order_pembayaran = "-" WHERE order_id = "${orderID}"`)
    }
  } catch (error) {
      console.error('Error handling notification:', error);
      res.status(500).send('Internal server error');
  }
});

router.post('/sendmail', async (req, res) => {
  orderID = req.query.order_id
  database.query(`SELECT * FROM db_order WHERE order_id = ?`, [orderID], async (err, data) => {
    database.query(`SELECT * FROM db_user WHERE user_email = ?`, [data[0].product_owner], async (err, res) => {
      const mailOptionss = {
        from: 'CAH KOST <admin@cahkost.my.id>',
        to: data[0].order_email,
        subject: `Transaksi Berhasil #${orderID}`,
        text: `
Halo ${data[0].order_name},

Terima kasih telah melakukan transaksi di CahKost. Kami senang memberi tahu bahwa transaksi Anda telah berhasil dengan detail sebagai berikut:

-------------------------------------------------------
Nomor Pesanan: #${orderID}
Nama Kost: ${data[0].product_name}
Alamat Kost: ${data[0].product_address}
Kontak Kost: ${res[0].user_nohp}
Durasi Sewa: ${data[0].order_durasi} bulan | ${data[0].order_masa}
Total Pembayaran: Rp ${data[0].order_price.toLocaleString('id-ID')}
Tanggal Transaksi: ${data[0].order_pembayaran}
-------------------------------------------------------
Hubungi kontak pemilik kost untuk menempati kost Anda.

Mohon simpan email ini sebagai bukti transaksi Anda. Anda dapat mengakses detail pemesanan Anda kapan saja di akun Anda di CahKost.
Jika Anda memiliki pertanyaan lebih lanjut, jangan ragu untuk menghubungi kami di unesacahkost@gmail.com.

Salam hangat,
Tim CahKost
`,
      };
  
      await transporter.sendMail(mailOptionss);
    });
  });
})

module.exports = router;