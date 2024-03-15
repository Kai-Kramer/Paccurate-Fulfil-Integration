export const handler = async (event, context) => {
  // TODO: need to check that this is coming from fulfil
  // rudimentary check to see if the request is not malformed
  console.info("Received:\n" + JSON.stringify(event));
  const callBody = JSON.parse(event.body);
  console.log(JSON.stringify(callBody));
  if (
    callBody &&
    callBody.items // we're good
  );
  else throw "Invalid Payload";
  
  
  // callBody.test should be an array of product ids
  /* if (callBody.test) {
    console.log("testing db fetch and fulfil get");
    const ids = callBody.test;
    
    
    const test_dbCall = { operation: "get", body: ids};
    const test_templates = await getTemplates(test_dbCall);
  
    console.log("templates from rds db", test_templates);
    const test_missing = ids.reduce((prev, curr) => {
      if (test_templates.find(e => e.id === curr) === undefined) prev.push(curr);
      return prev;
    },[])

    console.log("missing: " + test_missing);

    if (test_missing.length !== 0) {
      // search_read from fulfil to get templates
      const callBody = {
        "filters": [test_missing.reduce((prev, curr) => {prev.push(["id", "=", curr]); return prev;}, ["OR"])],
        "fields": [
          "id",
          "template"
          ]
      }
      console.log("callBody: " + JSON.stringify(callBody));
      const fulfil_templates = await search_readFulfil(callBody);
      console.log("fulfil_templates: " + fulfil_templates)
      const db_insert = await getTemplates({operation: "put", body: fulfil_templates});
      return {
        statusCode: 200,
        body: JSON.stringify(db_insert)
      };
    }
    return {
      statusCode: 200,
      body: `ain't got nothin to do`
    };
  }*/
  
  /* Finding each item's template */
  const skus = callBody.items.reduce((prev, curr) => {
    prev.push(curr.product.id);
    return prev;
  }, []);
  console.log("skus", skus);
  const dbCall = { operation: "get", body: skus};
  let templates = await getTemplates(dbCall);

  console.log("templates from rds db", templates);
  
  /* Get missing templates from Fulfil */
  const missing = skus.reduce((prev, curr) => {
    if (templates.find(e => e.id === curr) === undefined) prev.push(curr);
    return prev;
  },[])
  
  if (missing.length !== 0) {
    // search_read from fulfil to get templates
    const callBody = {
      "filters": [missing.reduce((prev, curr) => {prev.push(["id", "=", curr]); return prev;}, ["OR"])],
      "fields": [
        "id",
        "template"
        ]
    }
    const missingTemplates = await search_readFulfil(callBody);
    templates.concat(missingTemplates);
    
    if (missingTemplates.length !== 0) {
      const inserts = await getTemplates({operation: "put", body: missingTemplates});
      console.info(JSON.stringify(inserts));
    }
  }
  
  /* Shortcut for single offer --> use default box */
  // 66 = inserts; 67 = stickers
  const insertIds = templates.filter(e => e.template === 66 || e.template === 67).map(e => e.id);
  const nonInserts = callBody.items.filter(e => !insertIds.includes(e.product.id))   // exclude inserts/stickers from parent evaluation
  if (nonInserts.length !== 0                                                        // there exists a non-insert,
  &&  nonInserts.every(e => e.parent === undefined || e.parent.quantity === 1)       // All lines w/ parents have parent quantity=1
  &&  nonInserts.filter(e => e.parent && e.parent.quantity === 1)                    // and there exists only one unique parent object
      .map(e => e.parent.id).filter((v, i, a) => a.indexOf(v) === i).length === 1) {
    
    const box_type = []
    let level = nonInserts[0].parent;
    do {
      if (level.product.box_type !== null) box_type.push(level.product.box_type.id);
      else level = level.parent;
      if (level === null) throw "Invalid Payload";
    } while (box_type.length === 0)
    
    const output = {
      statusCode: 200,
      body: JSON.stringify({
        packages: [{
          box_type: box_type[0],
          items: callBody.items.reduce((prev, curr) => {
            prev.push({id: curr.id, quantity: curr.quantity});
            return prev;
          }, [])
          /*[{
            id: callBody.items[0].id,
            quantity: callBody.items[0].quantity
    }]*/}]})};
    
    console.info("Shortcut: single offer\n", JSON.stringify(output));
    return output;
  }
  
  /*  Make fulfil's request paccurate-intelligible  */
  /*console.log(
    "Request Body from fulfil (items)",
    JSON.stringify(callBody.items),
    "Request Body from fulfil (available_box_types)",
    JSON.stringify(callBody.available_box_types)
  );*/

  // This is logic to filter out poly mailer when oil or powder is present
  const hasOilOrPowder = templates.some((v) => [61, 64, 650, 651].includes(v.template));
  const hasPowderOver20Oz = templates.some( v => v.template === 652 )
  console.info("hasOil", hasOilOrPowder);
  console.info("powderOver20OzBoxes", hasPowderOver20Oz);
  

/* Shortcut for 1-6/7-12 standard bottles */
  if (hasOilOrPowder === false) {
    const countBottles = callBody.items.reduce((prev, curr) => {
      prev += (isBottle(curr) || (!(templates.find(e => e.id === curr.product.id).template === 66) && 1000)) * curr.quantity;
      return prev;
    }, 0);
    
    console.info(`Calulated ${countBottles} standard bottles`);
    
    
    // fulfil sent us an empty cartonization request?
    if (countBottles === 0) {
      // console.log("Calculated 0 bottles!!")
      return {statusCode: 400, body: "Empty cartonization request"};
    }
    
    // we can short circuit!
    else if (countBottles <= 12) {
      const items = callBody.items.reduce( (prev, curr) => {
        prev.push({id: curr.id, quantity: curr.quantity})
        return prev;
      }, [])
      
      // use box id 226 for #2 mailers (1-6 items) and box id 227 for #5 mailers (7-12 items)
      const output = {
        statusCode: 200,
        body: JSON.stringify({
          packages: [{
            box_type: (countBottles <= 6) ? 226 : 227,
            items: items
      }]})};
      console.info("Shortcut: 1-6/7-12\n", JSON.stringify(output));
      return output;
    }
  }

/* Shortcut for 1-12/13-18 slim bottles */
// 649 is Template Products / Oils - Plastic
if (templates.some(e => e.template === 649)) {
  const count = callBody.items.reduce((prev, curr) => {
    let currTemplate = templates.find(e => e.id == curr.product.id).template;
    prev += (currTemplate === 649 || (!currTemplate === 66 && 1000)) * curr.quantity;
    return prev;
  },0);
  
  console.info(`calculated ${count} slim bottles.`);
  
  if (count === 0) {
    return {statusCode: 400, body: "Empty cartonization request."};
  }
  
  // we may be able to short circuit...
  else if (count <= 18) {
    const items = callBody.items.reduce( (prev, curr) => {
      prev.push({id: curr.id, quantity: curr.quantity});
      return prev;
    }, [])
    
    const output = {
      statusCode: 200,
      body: JSON.stringify({
        packages: [{
          box_type: (count <= 12) ? 226 : 227,
          items: items
    }]})};
    console.info("Shortcut: 1-12/13-18 slim\n", JSON.stringify(output));
    return output;
  }
}

  // These boxes should only be used if template 652 exists in an order
  const powderOver20OzBoxes = [
    223, 231, 235
  ];

  // Jetpack doesn't want to use small boxes if poly mailers are available
  const largeBoxes = [
    219, 220, 221, 222
  ];

  const boxIdsWithoutPolyMailers = [
    216, 217, 218, 236
  ];

  const polyMailerBoxIds = [226, 227];

  const whitelistedBoxIds = [...largeBoxes, ...boxIdsWithoutPolyMailers];
  
  if (hasPowderOver20Oz) whitelistedBoxIds.concat(powderOver20OzBoxes);

  // this is a hardcoded solution for product id 4866
  // const products4866 = callBody.items.filter((v) => v.product.id === 4866);
  const products4866 = []; // temporarily remove hardcoded logic

  const filteredBoxTypes = callBody.available_box_types.filter((v) => whitelistedBoxIds.includes(v.id)  );

  console.info("filtered Box types", filteredBoxTypes);

  const paccPayload = _FulfilToPaccurate(callBody.items, filteredBoxTypes);

  console.log(
    "Request Body for Paccurate API (itemSets) :",
    JSON.stringify(paccPayload.itemSets),
    "Request Body for Paccurate API (boxTypes):",
    JSON.stringify(paccPayload.boxTypes)
  );

  console.info("request payload to paccurate api", JSON.stringify(paccPayload));

  const boxes = await postPaccurate(paccPayload);
  const response = {
    statusCode: 200,
    body: JSON.stringify(_PaccurateToFulfil(boxes)),
  };

  console.info("To API Gateway -> Fulfil:\n", JSON.stringify(response));
  return response;
};

//hardcoded function for 4866 product
function getBoxTypeFor4866(products4866) {
  const totalQuantity4866 = products4866.reduce((total, curr) => {
    return total + curr.quantity;
  }, 0);

  if (totalQuantity4866 > 9) return [221];
  if (totalQuantity4866 > 6) return [219];
  if (totalQuantity4866 > 3) return [218];
  return [217];
}

function isBottle(item) {
  // simple check for two 2.3 dims and a 4 dim. Aliased for readability
  const providedSizes = [item.product.length, item.product.width, item.product.height]
  return (Math.abs(providedSizes[0] - 4.05) < 0.1 && Math.abs(providedSizes[1] - 2.15) < 0.16 && Math.abs(providedSizes[2] - 2.15) < 0.16) 
      || (Math.abs(providedSizes[0] - 2.15) < 0.16 && Math.abs(providedSizes[1] - 4.05) < 0.1 && Math.abs(providedSizes[2] - 2.15) < 0.16) 
      || (Math.abs(providedSizes[0] - 2.15) < 0.16 && Math.abs(providedSizes[1] - 2.15) < 0.16 && Math.abs(providedSizes[2] - 4.05) < 0.1);
}

function isInsert(item) {
  return (item.product.length <= 0.1 && item.product.width <= 0.1 && item.product.height <= 0.1);
}

async function getTemplates(skus) {
  try {
    const response = await fetch(
      "https://hvlzlibbnorvqwt25usysn467i0flzxx.lambda-url.us-east-2.on.aws/ ",
      {
        method: "POST",
        mode: "cors",
        body: JSON.stringify(skus),
      }
    );
    const templates = await response.json();
    return templates;
  } catch (err) {
    console.log(err);
    return err;
  }
}

/*
 * PUTs a search_read to find missing templates
 */
async function search_readFulfil(requestBody) {
  try {
    const res = await fetch("https://jetpackshipping.fulfil.io/api/v2/model/product.product/search_read", {
      method: "PUT",
      mode: "cors",
      headers: {
        "x-api-key": `${process.env.FULFIL_KEY}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const templates = await res.json();
    return templates;
  } catch (error) {
    console.log(error);
    return error;
  }
}

async function postPaccurate(requestBody) {
  try {
    const res = await fetch("https://api.paccurate.io/", {
      method: "POST",
      mode: "cors",
      headers: {
        Authorization: `apikey ${process.env.PACCURATE_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const boxes = await res.json();
    console.info("Paccurate returned:\n", JSON.stringify(boxes));
    return boxes;
  } catch (error) {
    console.log(error);
    return error;
  }
}

// convert fulfil API call to paccurate-compliant Object
// quantity must be in u.
// TODO: normalize distance UOMs
function _FulfilToPaccurate(items, boxes) {
  const item_sets = items.reduce((prev, curr) => {
    // invalidate if missing data
    if (curr.product.length && curr.product.width && curr.product.height)
      prev.push({
        refId: curr.id,
        dimensions: {
          x: curr.product.length,
          y: curr.product.width,
          z: curr.product.height,
        },
        quantity: curr.quantity,
      });
    else throw "Item " + curr.product.code + " Is missing dimensions.";
    return prev;
  }, []);

  const box_types = boxes.reduce((prev, curr) => {
    if (curr.length && curr.width && curr.height)
      prev.push({
        refId: curr.id,
        dimensions: {
          x: curr.length,
          y: curr.width,
          z: curr.height,
        },
      });
    return prev;
  }, []);
  const itemRefIds = item_sets.map((v) => v.refId);
  /*
  const lockOrientationRules = itemRefIds.map((v) => ({
    itemRefId: v,
    operation: "lock-orientation",
    options: {
      freeAxes: [2],
    },
  }));
  */
  /*
  const compactRules = itemRefIds.map((v) => ({
    itemRefId: v,
    operation: "compact-pattern",
    options: {
      alternating: false,
      compactibleAxes: [0],
      compactProperties: [
        {
          targetRefId: null,
          compactibleAxisDimensionChange: [
            {
              x: -0.95,
            },
          ],
        },
      ],
    },
  }));
  */
  return {
    itemSets: item_sets,
    boxTypes: box_types,
    rules: [/*...lockOrientationRules, ...compactRules*/],
    boxesMax: 1,
    boxTypeChoiceGoal: "most-items",
    itemInitialOrientationBestForBox: true
  };
}

// Convert paccurate response. We have to tally unique refIds,
// which is why that inner function is there.
function _PaccurateToFulfil(paccPayload) {
  // counts the number of occurences for each unique item in arr
  function tallyUnique(arr) {
    const map = new Map();
    const outArr = [];

    arr.forEach((e) => {
      if (map.has(e.item.refId)) {
        map.set(e.item.refId, map.get(e.item.refId) + 1);
      } else {
        map.set(e.item.refId, 1);
      }
    });

    map.forEach((value, key) => {
      outArr.push({ id: key, quantity: value });
    });
    return outArr;
  }

  const data = paccPayload.boxes;
  const fulfilCompliant = {
    packages: data.reduce((prev, curr) => {
      prev.push({
        box_type: curr.box.boxType.refId,
        items: tallyUnique(curr.box.items),
      });
      return prev;
    }, []),
  };

  return fulfilCompliant;
}
