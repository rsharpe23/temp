const { mat4 } = glMatrix;

const glu = {
  createProgram(gl, vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Incorrect program link');
    }
  
    return program;
  },

  createShader(gl, type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
  
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Incorrect shader compile');
    }
  
    return shader;
  },

  createBuffer(gl, target, data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  },

  setAttribute(gl, attr, { buffer, componentsPerAttr, componentType }) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl));
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, componentsPerAttr, 
      componentType, false, 0, 0);
  }
};

class TRS {
  constructor({ translation, rotation, scale }, parent) {
    this.translation = translation ?? [0, 0, 0];
    this.rotation = rotation ?? [0, 0, 0, 1];
    this.scale = scale ?? [1, 1, 1];
    this.parent = parent;
  }

  calcMatrix() {
    const mat = this._calcMatrix();
    if (this.parent) {
      mat4.mul(mat, this.parent.calcMatrix(), mat);
    }

    return mat;
  }

  _calcMatrix() {
    const mat = mat4.create();
    mat4.fromRotationTranslationScale(mat, 
      this.rotation, this.translation, this.scale);

    return mat;
  }
}

const gltf = {
  typeSizeMap: {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
  },

  Scene: class {
    constructor(nodeTree, meshProvider) {
      this.nodeTree = nodeTree;
      this.meshProvider = meshProvider;
    }
  
    static from({ scene, scenes, nodes, 
      meshes, accessors, bufferViews, buffers }) {

      const nt = new gltf.NodeTree(null, scenes[scene].nodes, nodes);

      const meshProvider = new gltf.MeshProvider(meshes, accessors, 
        new gltf.BufferProvider(bufferViews, buffers));

      return new gltf.Scene(nt, meshProvider);
    }

    *[Symbol.iterator]() {
      yield* this.nodeTree.traverse((node, parent) => {
        node.trs = new TRS(node, parent?.trs);
        node.mesh = this.meshProvider.getMesh(node);
        return node;
      });
    }
  },
  
  NodeTree: class {
    constructor(root, children, nodes) {
      this.root = root;
      this.children = children;
      this.nodes = nodes;
    }

    *traverse(fn) {
      for (const node of this.children) {
        const { children, ...rest } = this.nodes[node];
        yield fn(rest, this.root);
        
        if (children) {
          const nt = new gltf.NodeTree(rest, children, this.nodes);
          yield* nt.traverse(fn);
        }
      }
    }
  },

  MeshProvider: class {
    constructor(meshes, accessors, bufferProvider) {
      this.meshes = meshes;
      this.accessors = accessors;
      this.bufferProvider = bufferProvider;
    }

    getMesh({ mesh }) {
      return this._getMesh(this.meshes[mesh]);
    }

    _getMesh({ primitives }) {
      return primitives.map(prim => ({
        attrs: Object.entries(prim.attributes)
          .reduce((attr, [key, value]) => {
            attr[key] = this._getBuffer(value);
            return attr;
          }, {}),

        indexBuffer: this._getBuffer(prim.indices),
      }));
    }

    _getBuffer(accessor) {
      return this.bufferProvider
        .getBuffer(this.accessors[accessor]);
    }
  },

  BufferProvider: class {
    constructor(bufferViews, buffers) {
      this.bufferViews = bufferViews;
      this.buffers = buffers; 
    }

    getBuffer({ bufferView, type, ...rest }) {
      const buffer = this._getBuffer(this.bufferViews[bufferView]);
      const componentsPerAttr = gltf.typeSizeMap[type];
      return { ...rest, buffer, componentsPerAttr };
    }

    _getBuffer({ buffer, byteOffset: bo, byteLength: bl, target }) {
      const data = new Uint8Array(this.buffers[buffer], bo, bl);
      return gl => glu.createBuffer(gl, target, data);
    }
  },

  async load(path) {
    const res = await fetch(gltf.getURL(path));
    const data = await res.json();
    const { uri } = data.buffers[0];
    const res2 = await fetch(gltf.getURL(path, uri));
    data.buffers[0] = await res2.arrayBuffer();
    return data;
  },

  async loadScene(path) {
    const data = await gltf.load(path);
    return gltf.Scene.from(data);
  },
  
  getURL(path, file = gltf.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

// -----------------

class Scene {
  constructor(actors) {
    this.actors = actors;
  }

  addActor(actor) {
    this.actors.push(actor);
  }

  removeActor(actor) {
    const index = this.actors.indexOf(actor);
    ~index && this.actors.splice(index, 1);
  }

  removeActorBy(name) {
    const actor = this.findActor(name);
    actor && this.removeActor(actor);
  }

  findActor(name) {
    return this.actors.find(actor => actor.name === name);
  }

  render(appCtx, deltaTime) {
    // --------
    const { canvas: { width, height }, gl, program, matrix } = appCtx;

    gl.clearColor(0.0, 0.0, 0.14, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(matrix.projection, 1.04, width / height, 0.1, 1000.0);
    gl.uniformMatrix4fv(program.u_PMatrix, false, matrix.projection);

    program.setLightUniforms();
    program.setMaterialUniforms();
    // --------

    for (const actor of this.actors) {
      actor.render(appCtx, deltaTime);
    }
  }
}

class Actor {
  constructor(name) {
    this.name = name;
  }

  render(appCtx, deltaTime) {
    throw new Error('Not implemented');
  }
}

// Базовый класс для 3D-объектов. 
// Для 2D - это может быть Sprite.
class Mesh extends Actor {
  constructor(name, nodes) {
    super(name);
    this.nodes = nodes;
  }

  findNode(name) {
    return this.nodes.find(node => node.name === name);
  }

  render({ gl, program, matrix }) {
    for (const { trs, mesh } of this.nodes) {
      // --------
      mat4.identity(matrix.modelView);
      mat4.translate(matrix.modelView, matrix.modelView, [0.0, -0.8, -10.0]);
      // --------

      mat4.mul(matrix.modelView, matrix.modelView, trs.calcMatrix());
      gl.uniformMatrix4fv(program.u_MVMatrix, false, matrix.modelView);

      mat4.invert(matrix.modelView, matrix.modelView);
      mat4.transpose(matrix.normal, matrix.modelView);
      gl.uniformMatrix4fv(program.u_NMatrix, false, matrix.normal);

      for (const { attrs, indexBuffer } of mesh) {
        program.setAttributes(attrs);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer(gl));
        gl.drawElements(gl.TRIANGLES, indexBuffer.count, 
          indexBuffer.componentType, 0);
      }
    }
  }
}

// -----------------

const util = {
  getProgram(gl) {
    const vs = util.getShader(gl, 'shader-vs');
    const fs = util.getShader(gl, 'shader-fs');
    return glu.createProgram(gl, vs, fs);
  },

  getShader(gl, elemId) {
    const { text, type } = document.getElementById(elemId);
    const sType = util.getShaderType(gl, type);
    return glu.createShader(gl, sType, text);
  },

  getShaderType(gl, elemType) {
    const type = elemType.match(/x-shader\/x-(\D+)/)[1]
      .toUpperCase().trim();

    return gl[`${type}_SHADER`];
  }
};

const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');

const app = {
  ctx: {
    canvas, gl, 
    program: getProgram(gl), 
    matrix: {
      projection: mat4.create(),
      modelView: mat4.create(),
      normal: mat4.create(),
    }
  },

  run(scene) {
    scene.render(app.ctx, 0);
  }
};

function getProgram(gl) {
  const p = util.getProgram(gl);

  p.POSITION = gl.getAttribLocation(p, "a_Position");
  p.NORMAL = gl.getAttribLocation(p, "a_Normal");

  p.u_PMatrix = gl.getUniformLocation(p, "u_PMatrix");
  p.u_MVMatrix = gl.getUniformLocation(p, "u_MVMatrix");
  p.u_NMatrix = gl.getUniformLocation(p, "u_NMatrix");

  p.u_AmbientColor = gl.getUniformLocation(p, "u_AmbientColor");
  p.u_DirectionalColor = gl.getUniformLocation(p, "u_DirectionalColor");
  p.u_SpecularColor = gl.getUniformLocation(p, "u_SpecularColor");
  p.u_LightingPos = gl.getUniformLocation(p, "u_LightingPos");

  p.u_MaterialAmbientColor = gl.getUniformLocation(p, "u_MaterialAmbientColor");
  p.u_MaterialDiffuseColor = gl.getUniformLocation(p, "u_MaterialDiffuseColor");
  p.u_MaterialSpecularColor = gl.getUniformLocation(p, "u_MaterialSpecularColor");

  p.setLightUniforms = () => {
    gl.uniform3f(p.u_AmbientColor, 0.4, 0.4, 0.4);
    gl.uniform3f(p.u_DirectionalColor, 0.8, 0.8, 0.8);
    gl.uniform3f(p.u_SpecularColor, 1.0, 1.0, 1.0);
    gl.uniform3fv(p.u_LightingPos, [0.0, -7.0, -10.0]);
  };

  p.setMaterialUniforms = () => {
    gl.uniform3f(p.u_MaterialAmbientColor, 0.0, 0.0, 0.0);
    gl.uniform3f(p.u_MaterialDiffuseColor, 0.2, 0.6, 0.4);
    gl.uniform3f(p.u_MaterialSpecularColor, 0.8, 0.8, 0.8);
  };

  p.setAttributes = attrs => {
    for (const key in attrs) {
      if (Object.hasOwnProperty.call(p, key)) {
        glu.setAttribute(gl, p[key], attrs[key]);
      }
    }
  };

  return p;
}

// -----------------

gltf.loadScene('tank').then(scene => {
  const tank = new Mesh('tank', Array.from(scene));
  app.run(new Scene([tank]));
});