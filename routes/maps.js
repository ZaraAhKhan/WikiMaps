/*
 * All routes for Maps are defined here
 * Since this file is loaded in server.js into api/maps,
 *   these routes are mounted onto /maps
 * See: https://expressjs.com/en/guide/using-middleware.html#middleware.router
 */

const { query } = require('express');
const express = require('express');

const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.urlencoded({ extended: true }));

const cookieSession = require('cookie-session');
const res = require('express/lib/response');

app.use(cookieSession({
  name: "session",
  keys: ['key1', 'key2'],
}));

const StaticMaps = require('staticmaps');

const mapsRouter = (db) => {
  //-----------------------------------------------------
  // GET METHODS ----------------------------------------
  //-----------------------------------------------------

  // GET /maps/map/:id
  router.get('/map/:id', (req, res) => {
    const queryString = `
      SELECT
        maps.id,
        maps.creator_id,
        maps.title,
        maps.description,
        maps.latitude AS map_lat,
        maps.longitude AS map_lng,
        maps.location AS map_loc,
        users.name AS created_by,
        points.title AS point_name,
        points.description AS point_description,
        points.image AS point_img,
        points.latitude AS latitude,
        points.longitude AS longitude
      FROM maps
       JOIN users ON users.id = maps.creator_id
       LEFT JOIN points ON points.map_id = maps.id
       WHERE maps.id = $1
       ORDER BY points.id desc ;
      `;
    const queryString1 = `
  SELECT map_id
  FROM favourites
  WHERE user_id = $1;`;

    db.query(queryString1, [req.session.user_id])
      .then((result1) => result1.rows)
      .then((result1) => {
        db.query(queryString, [req.params.id])
          .then((result) => {
            res.render('map_id', {
              user: req.session.user_id,
              mapData: result.rows,
              favMapsObj: result1,
            });
          });
      })
      .catch((err) => {
        res
          .status(500)
          .json({ error: err.message });
      });
  });

  // GET /maps/create
  router.get('/create', (req, res) => {
    if (!req.session.user_id) {
      res.redirect('/');
    }

    res
      .status(200)
      .render('map_create', {
        user: req.session.user_id,
      });
  });

  // GET /map/<id>/lat/<latitude>/lng/<longitude> --> create jpeg image at given coords
  router.get('/map/:id/lat/:lat/lng/:lng', async(req, res) => {
    const map = new StaticMaps({
      width: 600,
      height: 400,
    });

    const zoom = 12;

    const latitude = Number(req.params.lat);
    const longitude = Number(req.params.lng);
    const center = [longitude, latitude];

    const mapID = req.params.id;

    await map.render(center, zoom);

    await map.image.save(`public/images/maps/map-${mapID}.png`);

    res.redirect(`/maps/map/${mapID}`);
  });

  // GET /maps/download-all --> download all map images for maps in DB
  router.get('/download-all', (req, res) => {

    async function saveImage(mapObject) {

      const map = new StaticMaps({
        width: 600,
        height: 400,
      });

      const zoom = 12;

      const latitude = Number(mapObject.latitude);
      const longitude = Number(mapObject.longitude);
      const center = [longitude, latitude];

      const mapID = mapObject.id;

      await map.render(center, zoom);
      await map.image.save(`public/images/maps/map-${mapID}.png`);
    }

    const queryString = `SELECT * FROM maps;`;

    db
      .query(queryString)
      .then(records => {

        records.rows.forEach(element => {
          saveImage(element)
          console.log(`Saved map: map-${element.id}.png`);
        });
      })
      .then(() => {
        console.log('Save completed');
        res.send('All maps downloaded to /images/maps/...');
      });
  });

  // GET /maps/ --> redirect to GET /maps/1 (page 1 search results default)
  router.get('/', (req, res) => {
    res.redirect('/maps/1');
  });

  // GET /maps/:page
  router.get('/:page', (req, res) => {
    const resultsPerPage = 9; // 3x3 grid per page
    const pageNum = Number(req.params.page) || 1;

    const queryStringData = `
      SELECT maps.*, users.name AS created_by
      FROM maps
      JOIN users ON users.id = maps.creator_id
      ORDER BY id DESC
      LIMIT $1
      OFFSET $2
      ;`;

    const values = [resultsPerPage, (pageNum - 1) * resultsPerPage];

    const queryStringPages = `
      SELECT COUNT(*) FROM maps
    ;`;

    const queryStringFav = `
    SELECT map_id
    FROM favourites
    WHERE user_id = $1;`;

    // first query, to obtain total map records (for page navigation)
    db
      .query(queryStringPages)
      .then((records) => records.rows[0])
      .then((records) => {
        // second query, to obtain favourites results
        db
          .query(queryStringFav, [req.session.user_id])
          .then((favResults) => favResults.rows)
          .then((favResults) => {
            // third query, to obtain filtered map data to display on page
            db
              .query(queryStringData, values)
              .then((data) => {
                // render view with query results from all queries
                res.render('maps', {
                  user: req.session.user_id,
                  mapList: data.rows,
                  favMapsObj: favResults,
                  page: pageNum,
                  startingRecord: (pageNum - 1) * resultsPerPage,
                  maxPages: Math.ceil(records.count / resultsPerPage),
                  totalRecords: records.count,
                });
              });
          });
      })
      .catch((err) => {
        res
          .status(500)
          .json({ error: err.message });
      });
  });

  //-----------------------------------------------------
  // POST METHODS ---------------------------------------
  //-----------------------------------------------------

  // POST /maps/create
  router.post('/create', (req, res) => {
    const queryString = `
      INSERT INTO maps (creator_id, title, description, latitude, longitude, location)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;`;
    const values = [
      req.session.user_id,
      req.body.title,
      req.body.description,
      req.body.map_lat,
      req.body.map_lng,
      req.body.location,
    ];

    db.query(queryString, values)
      .then((result) => {
        res
          .status(200)
          .redirect(`/maps/map/${result.rows[0].id}/lat/${req.body.map_lat}/lng/${req.body.map_lng}`);
      })
      .catch((err) => {
        res
          .status(500)
          .json({ error: err.message });
      });
  });

  // POST /maps/pointer
  router.post('/pointer', (req, res) => {
    const queryString = `
    INSERT INTO points (map_id, creator_id, title, description, image, latitude, longitude)
    VALUES ($1, $2, $3, $4,$5, $6, $7)
    `;
    const values = [
      req.body.map_id,
      req.session.user_id,
      req.body.point_title,
      req.body.point_description,
      req.body.img_url,
      req.body.form_lat,
      req.body.form_lng];
    db.query(queryString, values)
      .then((result) => {
        res
          .redirect(`/maps/map/${req.body.map_id}`);
      })
      .catch((err) => {
        res
          .status(500)
          .json({ error: err.message });
      });
  });

  router.post('/pointer/:id', (req, res) => {
    // res.send(`response id is ${req.params.id}`);
    const queryString = `
    DELETE FROM points
    WHERE id = $1;
    `;
    const values = [req.params.id];
    db.query(queryString, values)
      .then((result) => {
        console.log('point has been deleted');
        res.status(200);
        res.end();
        return result;
        // res.redirect('/users/contributions/');
      })
      .catch((err) => {
        res
          .status(500)
          .json({ error: err.message });
      });
  });

  router.post('/pointer/edit/:id', (req, res) => {
    const queryString = `
    UPDATE points
    SET title = $1,
        description = $2,
        image = $3,
        latitude = $4,
        longitude = $5
    WHERE id = $6;
    `;
    const values = [
      req.body.point_title,
      req.body.point_desc,
      req.body.point_img,
      req.body.point_lat,
      req.body.point_lng,
      req.params.id];
    db.query(queryString, values)
      .then((result) => {
        // res.status(200).send();
        console.log("successfully edited point", req.params.id);
        res.end();
      })
      .catch((err) => {
        console.log(req.body);
        console.log('error ', err);
        res
          .status(500)
          .json({ error: err.message, value: values });
      });
  });

  // POST /maps/search
  router.post('/search', (req, res) => {
    const queryString = `SELECT title,id
    FROM maps
    WHERE title LIKE '%'||$1||'%'
    LIMIT 3;
    `;
    console.log(req.body.input);
    db.query(queryString, [req.body.input])
      .then((result) => {
        console.log('queried the db', result.rows);
        res.send(result.rows);
      })
      .catch((err) => {
        console.log('Error', err.message);
      });
  });

  return router;
};

module.exports = mapsRouter;
