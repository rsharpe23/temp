const loader = {
  load(path, cb) {
    fetch(loader.getURL(path)).then(res => res.json())
      .then(data => {
        const { uri } = data.buffers[0];
        fetch(loader.getURL(path, uri)).then(res => res.arrayBuffer())
          .then(buffer => {
            data.buffers[0] = buffer;
            cb && cb(data);
          });
      });
  },
  
  getURL(path, file = loader.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

const gltf = {
  NodeTree: class {
    constructor(parent, children, nodes) {
      this.parent = parent;
      this.children = children;
      this.nodes = nodes;
    }
  
    static from({ scene, scenes, nodes }) {
      return new gltf.NodeTree(null, scenes[scene].nodes, nodes);
    }
  
    traverse(cb) {
      for (const child of this.children) {
        const { children, ...rest } = this.nodes[child];
        cb && cb(rest, this.parent);
  
        if (children) {
          new gltf.NodeTree(rest, children, this.nodes)
            .traverse(cb);
        }
      }
    }
  },

  MeshProvider: class {
    constructor({ meshes, accessors, bufferViews, buffers }) {
      this.meshes = meshes;
      this.accessors = accessors;
      this.bufferViews = bufferViews;
      this.buffers = buffers; 
    }

    getMesh(index) {
      return this._getMesh(this.meshes[index]);
    }

    _getMesh({ primitives, ...rest }) {
      primitives = primitives.map( prim => ({
        attributes: Object.entries(prim.attributes)
          .reduce((attr, [key, value]) => {
            attr[key] = this._getAccessorBy(value);
            return attr;
          }, {}),

        indices: this._getAccessorBy(prim.indices),
      }) );

      return { ...rest, primitives };
    }

    _getAccessorBy(index) {
      return this._getAccessor(this.accessors[index]);
    }

    _getAccessor({ bufferView: bv, ...rest }) {
      const bufferView = this._getBufferView(this.bufferViews[bv]);
      return { ...rest, bufferView };
    }
  
    _getBufferView({ buffer, byteOffset, byteLength, target }) {
      const data = new Uint8Array(this.buffers[buffer], 
        byteOffset, byteLength);
  
      return { target, data };
    }
  }
};

class Scene {
  constructor(nodes) {
    this.nodes = nodes;
  }

  addNode(node) {
    this.nodes.push(node);
  }

  findNode(name) {
    return this.nodes.find(node => node.name === name);
  }

  *[Symbol.iterator]() {
    for (const node of this.nodes) {
      yield node;
    }
  }
}

class TRS {
  constructor({ translation, rotation, scale }, parent) {
    this.translation = translation ?? [0, 0, 0];
    this.rotation = rotation ?? [0, 0, 0, 1];
    this.scale = scale ?? [1, 1, 1];
    this.parent = parent;
  }

  calcMatrix(m4) {
    const matrix = this._calcMatrix(m4);
    if (this.parent) {
      const pMatrix = this.parent.calcMatrix(m4);
      m4.mul(matrix, pMatrix, matrix);
    }

    return matrix;
  }

  _calcMatrix(m4) {
    const matrix = m4.create();
    m4.fromRotationTranslationScale(matrix, 
      this.rotation, this.translation, this.scale);
    return matrix;
  }
}

class MeshAdapter {
  constructor({ primitives }) {
    this.primitives = primitives;
  }

  getPrimitives(bufferProvider) {
    return this._getPrimitives( 
      ({ bufferView, type, componentType, count }) => ({
        buffer: bufferProvider.getBuffer(bufferView),
        componentsNum: utils.getComponentsNumOf(type),
        componentType, count,
      }) 
    );
  }

  _getPrimitives(fn) {
    return this.primitives.map( prim => ({
      vbo: fn(prim.attributes['POSITION']),
      nbo: fn(prim.attributes['NORMAL']),
      tbo: fn(prim.attributes['TEXCOORD_0']),
      ibo: fn(prim.indices),
    }) );
  }
}

function createScene(data) {
  return createSceneBy(gltf.NodeTree.from(data), 
    new gltf.MeshProvider(data));
}

function createSceneBy(nodeTree, meshProvider) {
  const scene = new Scene([]);

  nodeTree.traverse((node, parent) => {
    const trs = new TRS(node, parent && scene.findNode(parent.name)?.trs);
    const mesh = new MeshAdapter(meshProvider.getMesh(node.mesh));
    scene.addNode({ name: node.name, trs, mesh });
  });

  return scene;
}

loader.load('tank', data => {
  const { mat4 } = glMatrix;
  const scene = createScene(data);

  for (const { trs, mesh } of scene) {
    console.log({
      matrix: trs.calcMatrix(mat4),
      primitives: mesh.getPrimitives({ getBuffer: bv => bv }),
    });
  }
});