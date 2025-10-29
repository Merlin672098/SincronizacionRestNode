const express = require('express');
const router = express.Router();
const { firestore, admin } = require('../config/firebase');
const { getDbConnection } = require('../config/database');


// GET /testmql
// GET /test_mysql
router.get('/test_mysql', (req, res) => {
    const connection = getDbConnection();

    connection.connect((err) => {
        if (err) {
            console.error('Error al conectar a la base de datos MySQL:', err);
            return res.status(500).json({ error: 'No se pudo establecer conexión con la base de datos.' });
        }

        connection.end();
        return res.json({ message: 'Conexión a la base de datos MySQL exitosa.' });
    });
});


// POST /dispositivos/info
router.post('/asignar_dispositivo', async (req, res) => {
    const data = req.body;

    if (!data || (!data.id_dispositivo && !data.id_usuario)) {
        return res.status(400).json({ error: 'Datos incompletos. Se requiere id_dispositivo o id_usuario.' });
    }

    const { id_dispositivo, id_usuario } = data;
    const connection = getDbConnection();

    connection.connect(async (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al conectar a la base de datos MySQL.' });
        }

        try {
            const selectQuery = 'SELECT * FROM dispositivo WHERE id = ?';
            connection.query(selectQuery, [id_dispositivo], async (err, results) => {
                if (err) {
                    console.error('Error en la consulta MySQL 1 :', err);
                    return res.status(500).json({ error: 'Error en la consulta de la base de datos MySQL.' });
                }

                if (results.length > 0) {
                    const dispositivo = results[0];

                    if (dispositivo.estado !== 1) {
                        connection.end(); // Finalizamos la conexión aquí si hay un error.
                        return res.status(400).json({ error: 'El dispositivo está apagado.' });
                    }

                    if (dispositivo.id_usuario) {
                        connection.end(); // Finalizamos la conexión aquí si hay un error.
                        return res.status(400).json({ error: 'El dispositivo ya cuenta con un dueño.' });
                    }

                    console.log("los datos son:", id_usuario, " ", id_dispositivo);

                    const updateQuery = 'UPDATE dispositivo SET id_usuario = ? WHERE id = ?';
                    connection.query(updateQuery, [id_usuario, id_dispositivo], async (err) => {
                        if (err) {
                            console.error('Error al actualizar el dispositivo:', err);
                            connection.end(); // Finalizamos la conexión aquí en caso de error.
                            return res.status(500).json({
                                error: 'Error al actualizar el dispositivo en MySQL.',
                                query: updateQuery,
                            });
                        }

                        // Actualizar en Firestore
                        try {
                            const dispositivoRef = firestore.collection('dispositivos').doc(`${id_dispositivo}`);
                            await dispositivoRef.set({
                                id_usuario,
                                fecha_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
                            });

                            res.json({ message: 'Dispositivo actualizado correctamente en MySQL y Firestore.' });
                        } catch (firestoreError) {
                            console.error('Error en Firestore:', firestoreError);
                            return res.status(500).json({ error: 'Error al interactuar con Firestore.' });
                        } finally {
                            connection.end(); // Finalizamos la conexión aquí después de todas las operaciones.
                        }
                    });
                } else {
                    connection.end(); // Finalizamos la conexión aquí si no se encuentra el dispositivo.
                    return res.status(404).json({ error: 'Dispositivo no encontrado en MySQL.' });
                }
            });
        } catch (firestoreError) {
            console.error('Error en Firestore:', firestoreError);
            return res.status(500).json({ error: 'Error al interactuar con Firestore.' });
        }
    });
});
// POST /dispositivos/alert



router.post('/encendidoPlaca', (req, res) => {
    const data = req.body;

    if (!data || !data.id_dispositivo) {
        return res.status(400).json({ error: 'Datos incompletos. Se requiere id_dispositivo.' });
    }

    const id_dispositivo = data.id_dispositivo;
    const connection = getDbConnection();

    connection.connect((err) => {
        if (err) {
            console.error('Error al conectar a la base de datos MySQL:', err);
            return res.status(500).json({ error: 'No se pudo establecer conexión con la base de datos.' });
        }

        // Verifica si el dispositivo existe
        const selectQuery = 'SELECT * FROM dispositivo WHERE id = ?';
        connection.query(selectQuery, [id_dispositivo], (err, results) => {
            if (err) {
                console.error('Error en la consulta MySQL:', err);
                connection.end();
                return res.status(500).json({ error: 'Error en la consulta de la base de datos MySQL.' });
            }

            if (results.length > 0) {
                // Si el dispositivo existe, llama al procedimiento almacenado
                const dispositivo = results[0];
                const callQuery = 'CALL CambiarEstadoTemporal(?)';
                connection.query(callQuery, [id_dispositivo], (err) => {
                    if (err) {
                        console.error('Error al ejecutar el procedimiento:', err);
                        connection.end();
                        return res.status(500).json({ error: 'Error al ejecutar el procedimiento.' });
                    }

                    connection.end();
                    return res.json({ message: 'Estado activado temporalmente para el dispositivo.' });
                });
            } else {
                // Si el dispositivo no existe
                connection.end();
                return res.status(404).json({ error: 'No existe ese dispositivo.' });
            }
        });
    });
});


router.post('/alert', async (req, res) => {
    try {
      const { message, lat, lng, uid } = req.body;
  
      console.log('Valores recibidos:', { message, lat, lng, uid });
  
      if (!message || !lat || !lng || !uid) {
        return res.status(400).json({ msg: 'Todos los campos son requeridos: message, lat, lng, uid' });
      }
  
      const parsedLatitude = parseFloat(lat);
      const parsedLongitude = parseFloat(lng);
  
      if (isNaN(parsedLatitude) || isNaN(parsedLongitude)) {
        return res.status(400).json({ msg: 'Coordenadas inválidas' });
      }
  
      const alertData = {
        message,
        lat: parsedLatitude,
        lng: parsedLongitude,
        uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp() 
      };
  
      const querySnapshot = await firestore.collection('alerts').where('uid', '==', uid).get();
  
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref; 
        await docRef.update(alertData);
        console.log('Alerta actualizada con ID:', docRef.id);
        return res.status(200).json({ msg: 'Alerta actualizada exitosamente', data: alertData });
      } else {
        const newDocRef = await firestore.collection('alerts').add(alertData);
        console.log('Alerta creada con ID:', newDocRef.id);
        return res.status(201).json({ msg: 'Alerta creada exitosamente', data: alertData });
      }
    } catch (e) {
      console.error('Error durante la recepción de la alerta:', e);
      res.status(500).json({ error: e.message });
    }
  });


  router.post('/pow', async (req, res) => {
    try {
      const { message,uid } = req.body;
  
      console.log('Valores recibidos:', { message });
  
      if (!message|| !uid) {
        return res.status(400).json({ msg: 'Todos los campos son requeridos: message, lat, lng, uid' });
      }
  
  
      const alertData = {
        message,
        uid

      };
  
      const querySnapshot = await firestore.collection('colisiones').where('uid', '==', uid).get();
  
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref; 
        await docRef.update(alertData);
        console.log('poew actualizada con ID:', docRef.id);
        return res.status(200).json({ msg: 'poew actualizada exitosamente', data: alertData });
      } else {
        const newDocRef = await firestore.collection('colisiones').add(alertData);
        console.log('poew creada con ID:', newDocRef.id);
        return res.status(201).json({ msg: 'poew creada exitosamente', data: alertData });
      }
    } catch (e) {
      console.error('Error durante la recepción de la poew:', e);
      res.status(500).json({ error: e.message });
    }
  });
// POST /dispositivos/alert2 - Guarda en Firestore
router.post('/alert2', async (req, res) => {
  try {
    const { message, lat, lng, uid } = req.body; 

    console.log('Valores recibidos:', { message, lat, lng, uid }); 

    if (!message || !lat || !lng || !uid) { 
      return res.status(400).json({ msg: 'Todos los campos son requeridos: message, lat, lng, uid' });
    }

    const parsedLatitude = parseFloat(lat);
    const parsedLongitude = parseFloat(lng);

    if (isNaN(parsedLatitude) || isNaN(parsedLongitude)) {
      return res.status(400).json({ msg: 'Coordenadas inválidas' });
    }

    // Datos a guardar en Firestore
    const alertData = {
      message,
      lat: parsedLatitude,
      lng: parsedLongitude,
      uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // Buscar si ya existe un documento con ese uid
    const querySnapshot = await firestore.collection('alerts2').where('uid', '==', uid).get();

    if (!querySnapshot.empty) {
      // Si existe, actualizar el documento
      const docRef = querySnapshot.docs[0].ref;
      await docRef.update(alertData);
      console.log('Alerta2 actualizada con ID:', docRef.id);
      return res.status(200).json({ msg: 'Alerta recibida y actualizada exitosamente', data: alertData });
    } else {
      // Si no existe, crear un nuevo documento
      const newDocRef = await firestore.collection('alerts2').add(alertData);
      console.log('Alerta2 creada con ID:', newDocRef.id);
      return res.status(201).json({ msg: 'Alerta recibida y creada exitosamente', data: alertData });
    }
  } catch (e) {
    console.error('Error durante la recepción de la alerta:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alert3', async (req, res) => {
  try {
    const { 
      message, 
      lat, 
      lng, 
      uid,
      // Datos del ESP32
      tipo_envio,
      ax, ay, az,
      gx, gy, gz,
      totalG,
      gyroMag
    } = req.body; 

    console.log('📡 Valores recibidos:', { 
      message, 
      lat, 
      lng, 
      uid,
      tipo_envio,
      totalG,
      gyroMag
    }); 

    // Validación: puede venir de app móvil (uid, message) o de ESP32 (tipo_envio)
    if (!lat || !lng) { 
      return res.status(400).json({ msg: 'Se requieren coordenadas: lat, lng' });
    }

    // Si no viene uid, generar uno basado en el tipo de envío
    const finalUid = uid || `esp32_${Date.now()}`;
    
    // Si no viene message, construir uno basado en los datos del sensor
    let finalMessage = message;
    if (!message && tipo_envio) {
      if (tipo_envio === 'critico') {
        finalMessage = `🚨 ALERTA CRÍTICA: Impacto detectado (${totalG}g, ${gyroMag}°/s)`;
      } else if (tipo_envio === 'timer') {
        finalMessage = `⏰ Reporte programado`;
      } else {
        finalMessage = `📍 Telemetría normal`;
      }
    }

    const parsedLatitude = parseFloat(lat);
    const parsedLongitude = parseFloat(lng);

    if (isNaN(parsedLatitude) || isNaN(parsedLongitude)) {
      return res.status(400).json({ msg: 'Coordenadas inválidas' });
    }

    // Datos a guardar en Firestore
    const alertData = {
      message: finalMessage || 'Alerta sin descripción',
      lat: parsedLatitude,
      lng: parsedLongitude,
      uid: finalUid,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // Agregar datos del sensor si vienen del ESP32
    if (tipo_envio) {
      alertData.tipo_envio = tipo_envio;
      alertData.sensor_data = {
        acelerometro: {
          x: ax || 0,
          y: ay || 0,
          z: az || 0
        },
        giroscopio: {
          x: gx || 0,
          y: gy || 0,
          z: gz || 0
        },
        metricas: {
          totalG: totalG || 0,
          gyroMag: gyroMag || 0
        }
      };

      // Log especial para eventos críticos
      if (tipo_envio === 'critico') {
        console.log('🚨🚨🚨 EVENTO CRÍTICO DETECTADO 🚨🚨🚨');
        console.log(`   Ubicación: ${parsedLatitude}, ${parsedLongitude}`);
        console.log(`   Fuerza G: ${totalG}g`);
        console.log(`   Rotación: ${gyroMag}°/s`);
        
        // Aquí puedes agregar notificaciones adicionales:
        // - Enviar push notification
        // - Enviar SMS de emergencia
        // - Activar sirena en app móvil
      }
    }

    // Buscar si ya existe un documento con ese uid
    const querySnapshot = await firestore.collection('alerts2').where('uid', '==', finalUid).get();

    if (!querySnapshot.empty) {
      // Si existe, actualizar el documento
      const docRef = querySnapshot.docs[0].ref;
      await docRef.update(alertData);
      console.log('✅ Alerta2 actualizada con ID:', docRef.id);
      return res.status(200).json({ 
        success: true,
        msg: 'Alerta recibida y actualizada exitosamente', 
        data: alertData 
      });
    } else {
      // Si no existe, crear un nuevo documento
      const newDocRef = await firestore.collection('alerts2').add(alertData);
      console.log('✅ Alerta2 creada con ID:', newDocRef.id);
      return res.status(201).json({ 
        success: true,
        msg: 'Alerta recibida y creada exitosamente', 
        data: alertData 
      });
    }
  } catch (e) {
    console.error('❌ Error durante la recepción de la alerta:', e);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});
module.exports = router;